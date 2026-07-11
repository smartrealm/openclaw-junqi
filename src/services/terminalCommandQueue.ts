export interface PendingTerminalCommand {
  command: string;
  projectPath?: string;
}

const STORAGE_KEY = 'junqi:pending-terminal-commands';
const MAX_PENDING_COMMANDS = 32;
let memoryFallback: PendingTerminalCommand[] = [];

function appendMemory(command: PendingTerminalCommand): void {
  memoryFallback = [...memoryFallback, command].slice(-MAX_PENDING_COMMANDS);
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function normalizeCommand(value: unknown): PendingTerminalCommand | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { command?: unknown; projectPath?: unknown };
  if (typeof candidate.command !== 'string' || !candidate.command.trim()) return null;
  return {
    command: candidate.command,
    ...(typeof candidate.projectPath === 'string' && candidate.projectPath.trim()
      ? { projectPath: candidate.projectPath }
      : {}),
  };
}

function readQueue(storage: Storage): PendingTerminalCommand[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeCommand)
      .filter((command): command is PendingTerminalCommand => command !== null)
      .slice(-MAX_PENDING_COMMANDS);
  } catch {
    return [];
  }
}

export function enqueueTerminalCommand(
  command: PendingTerminalCommand,
  storage: Storage | null = browserSessionStorage(),
): void {
  const normalized = normalizeCommand(command);
  if (!normalized) return;
  if (!storage) {
    appendMemory(normalized);
    return;
  }
  try {
    const next = [...readQueue(storage), normalized].slice(-MAX_PENDING_COMMANDS);
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    appendMemory(normalized);
  }
}

export function takePendingTerminalCommands(
  storage: Storage | null = browserSessionStorage(),
): PendingTerminalCommand[] {
  const memoryPending = memoryFallback;
  memoryFallback = [];
  if (!storage) {
    return memoryPending;
  }
  try {
    const pending = [...readQueue(storage), ...memoryPending].slice(-MAX_PENDING_COMMANDS);
    storage.removeItem(STORAGE_KEY);
    return pending;
  } catch {
    return memoryPending;
  }
}
