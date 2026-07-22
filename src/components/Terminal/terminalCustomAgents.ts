import {
  isTerminalAgentId,
  type TerminalAgentId,
} from './terminalAgentCatalog';

/** A user-owned command. It runs in the real PTY, never through a mock API. */
export interface TerminalCustomAgent {
  id: string;
  title: string;
  command: string;
  baseAgentId: TerminalAgentId | null;
  env: string;
}

export interface TerminalCustomAgentPreferencesSnapshot {
  agents: readonly TerminalCustomAgent[];
  hiddenAgentIds: readonly string[];
}

interface StoredTerminalCustomAgentPreferences {
  agents?: unknown;
  hiddenAgentIds?: unknown;
}

const STORAGE_KEY = 'junqi:terminal-custom-agents';
const listeners = new Set<() => void>();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isCustomId(value: string): boolean {
  return /^custom-[a-z0-9-]{1,56}$/i.test(value);
}

function normalizeAgent(value: unknown, occupied: Set<string>): TerminalCustomAgent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  if (!isCustomId(id) || occupied.has(id)) return null;
  occupied.add(id);
  const baseCandidate = text(record.baseAgentId);
  return Object.freeze({
    id,
    title: text(record.title),
    command: text(record.command),
    baseAgentId: isTerminalAgentId(baseCandidate) ? baseCandidate : null,
    env: typeof record.env === 'string' ? record.env.trim() : '',
  });
}

function normalize(value: StoredTerminalCustomAgentPreferences | null | undefined): TerminalCustomAgentPreferencesSnapshot {
  const occupied = new Set<string>();
  const agents: TerminalCustomAgent[] = [];
  if (Array.isArray(value?.agents)) {
    for (const candidate of value.agents) {
      const agent = normalizeAgent(candidate, occupied);
      if (agent) agents.push(agent);
    }
  }
  const known = new Set(agents.map((agent) => agent.id));
  const hiddenAgentIds = Array.isArray(value?.hiddenAgentIds)
    ? [...new Set(value.hiddenAgentIds.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : [];
  return Object.freeze({ agents: Object.freeze(agents), hiddenAgentIds: Object.freeze(hiddenAgentIds) });
}

function read(): TerminalCustomAgentPreferencesSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) as StoredTerminalCustomAgentPreferences : null);
  } catch {
    return normalize(null);
  }
}

let snapshot = read();

function publish(next: TerminalCustomAgentPreferencesSnapshot): void {
  snapshot = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  for (const listener of listeners) listener();
}

function nextCustomId(): string {
  const known = new Set(snapshot.agents.map((agent) => agent.id));
  let number = 1;
  while (known.has(`custom-${number}`)) number += 1;
  return `custom-${number}`;
}

export function getTerminalCustomAgentPreferencesSnapshot(): TerminalCustomAgentPreferencesSnapshot {
  return snapshot;
}

export function subscribeTerminalCustomAgentPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mirrors Kooky: a custom needs a direct command or a real base launcher. */
export function visibleTerminalCustomAgents(
  preferences: TerminalCustomAgentPreferencesSnapshot = snapshot,
): readonly TerminalCustomAgent[] {
  const hidden = new Set(preferences.hiddenAgentIds);
  return preferences.agents.filter((agent) => !hidden.has(agent.id) && (agent.command.trim() || agent.baseAgentId));
}

export function terminalCustomAgentDisplayTitle(agent: TerminalCustomAgent): string {
  return agent.title.trim() || agent.id;
}

export function addTerminalCustomAgent(): TerminalCustomAgent {
  const agent = Object.freeze({ id: nextCustomId(), title: '', command: '', baseAgentId: null, env: '' });
  publish(normalize({ agents: [...snapshot.agents, agent], hiddenAgentIds: snapshot.hiddenAgentIds }));
  return agent;
}

export function updateTerminalCustomAgent(
  id: string,
  patch: Partial<Pick<TerminalCustomAgent, 'title' | 'command' | 'baseAgentId' | 'env'>>,
): void {
  if (!snapshot.agents.some((agent) => agent.id === id)) return;
  publish(normalize({
    agents: snapshot.agents.map((agent) => agent.id === id ? { ...agent, ...patch } : agent),
    hiddenAgentIds: snapshot.hiddenAgentIds,
  }));
}

export function deleteTerminalCustomAgent(id: string): void {
  if (!snapshot.agents.some((agent) => agent.id === id)) return;
  publish(normalize({
    agents: snapshot.agents.filter((agent) => agent.id !== id),
    hiddenAgentIds: snapshot.hiddenAgentIds.filter((candidate) => candidate !== id),
  }));
}

export function moveTerminalCustomAgent(id: string, direction: -1 | 1): void {
  const index = snapshot.agents.findIndex((agent) => agent.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= snapshot.agents.length) return;
  const agents = [...snapshot.agents];
  [agents[index], agents[destination]] = [agents[destination]!, agents[index]!];
  publish(normalize({ agents, hiddenAgentIds: snapshot.hiddenAgentIds }));
}

export function setTerminalCustomAgentHidden(id: string, hidden: boolean): void {
  if (!snapshot.agents.some((agent) => agent.id === id)) return;
  const next = new Set(snapshot.hiddenAgentIds);
  if (hidden) next.add(id);
  else next.delete(id);
  publish(normalize({ agents: snapshot.agents, hiddenAgentIds: [...next] }));
}

function envPairs(source: string): Array<[string, string]> {
  return source.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  });
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

/** Builds a platform-correct command prefix; values become real PTY env vars. */
export function terminalCustomAgentCommand(agent: TerminalCustomAgent, platform: 'windows' | 'posix'): string | null {
  const command = agent.command.trim() || agent.baseAgentId || '';
  if (!command) return null;
  const pairs = envPairs(agent.env);
  if (pairs.length === 0) return command;
  if (platform === 'windows') {
    const prefix = pairs.map(([key, value]) => `set \"${key}=${value.replace(/\"/g, '\"\"')}\"`).join(' && ');
    return `${prefix} && ${command}`;
  }
  const prefix = pairs.map(([key, value]) => `${key}=${quotePosix(value)}`).join(' ');
  return `${prefix} ${command}`;
}

/** Test-only reset for the module-level local preference store. */
export function resetTerminalCustomAgentPreferences(): void {
  snapshot = normalize(null);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const listener of listeners) listener();
}
