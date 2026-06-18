// Per-agent default persona persistence.
// Stored as a single localStorage entry keyed by agentId so the schema can
// grow without spamming keys. Only ChatTabs reads/writes — single source of
// truth for the "default persona for this agent" concept.

import type { SkillPersona } from '@/types/skills';

const STORAGE_KEY = 'aegis:agent-default-persona';
type StoredMap = Record<string, SkillPersona>;

function readAll(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota / disabled — silently drop; persona default just won't persist
  }
}

export function getAgentDefaultPersona(agentId: string): SkillPersona | null {
  const map = readAll();
  return map[agentId] ?? null;
}

export function setAgentDefaultPersona(agentId: string, persona: SkillPersona | null): void {
  const map = readAll();
  if (persona && persona.prompt) {
    map[agentId] = persona;
  } else {
    delete map[agentId];
  }
  writeAll(map);
}