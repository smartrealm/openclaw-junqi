export type ShellRuntimeState = 'starting' | 'running' | 'exited' | 'failed';

export interface ShellOutputEvent {
  shell_id: string;
  run_id: string;
  data: string;
}

export interface ShellExitEvent {
  shell_id: string;
  run_id: string;
  exit_code: number | null;
  reason: 'exited' | 'io_error' | 'wait_error';
}

export interface OpenShellResult {
    cwd: string;
    run_id: string;
    proxy: ShellProxyInfo | null;
}

export interface ShellProxyInfo {
  summary: string;
  entries: string[];
}

export interface ShellLaunchPathState {
  restartNonce: number;
  path: string;
}

export type TerminalAgentId = 'claude' | 'codex' | 'opencode';

export interface TerminalAgentActivity {
  agent: TerminalAgentId;
  state: 'running' | 'attention';
}

export interface TerminalHookEvent {
  shellId: string;
  runId: string;
  agent: string;
  kind: 'lifecycle' | 'tool';
  event: 'running' | 'attention' | 'ended' | 'pre' | 'post';
  toolName?: string;
  identifier?: string;
  success?: boolean;
  toolUseId?: string;
}

export interface TerminalToolCall {
  id: string;
  toolName: string;
  identifier?: string;
  state: 'running' | 'success' | 'failed' | 'stalled';
  startedAt: number;
  completedAt?: number;
}

const MAX_TERMINAL_TOOL_CALLS = 200;
export const TERMINAL_TOOL_CALL_STALL_MS = 60_000;

export function applyTerminalToolCallEvent(
  calls: TerminalToolCall[] | undefined,
  event: TerminalHookEvent,
  now = Date.now(),
): TerminalToolCall[] | undefined {
  if (event.kind !== 'tool' || !event.toolName) return calls;
  const identifier = event.identifier || undefined;
  const previous = calls ?? [];
  if (event.event === 'pre') {
    const id = event.toolUseId || `${event.toolName}:${identifier || 'unknown'}:${now}`;
    const next = { id, toolName: event.toolName, ...(identifier ? { identifier } : {}), state: 'running' as const, startedAt: now };
    return [...previous, next].slice(-MAX_TERMINAL_TOOL_CALLS);
  }
  if (event.event !== 'post') return calls;
  const index = event.toolUseId
    ? previous.findIndex((call) => call.id === event.toolUseId)
    : previous.findIndex((call) => (
      call.toolName === event.toolName
      && call.identifier === identifier
      && (call.state === 'running' || call.state === 'stalled')
    ));
  const id = event.toolUseId || `${event.toolName}:${identifier || 'unknown'}:${now}`;
  const completion = {
    id,
    toolName: event.toolName,
    ...(event.identifier ? { identifier: event.identifier } : {}),
    state: event.success === false ? 'failed' as const : 'success' as const,
    startedAt: index >= 0 ? previous[index].startedAt : now,
    completedAt: now,
  };
  if (index >= 0) return previous.map((call, callIndex) => callIndex === index ? completion : call);
  return [...previous, completion].slice(-MAX_TERMINAL_TOOL_CALLS);
}

export function markStalledTerminalToolCalls(
  calls: TerminalToolCall[] | undefined,
  now = Date.now(),
): TerminalToolCall[] | undefined {
  if (!calls?.some((call) => call.state === 'running' && now - call.startedAt > TERMINAL_TOOL_CALL_STALL_MS)) return calls;
  return calls.map((call) => (
    call.state === 'running' && now - call.startedAt > TERMINAL_TOOL_CALL_STALL_MS
      ? { ...call, state: 'stalled' as const, completedAt: now }
      : call
  ));
}

export function formatTerminalToolDuration(call: TerminalToolCall, now = Date.now()): string {
  const elapsed = Math.max(0, (call.completedAt ?? now) - call.startedAt);
  if (elapsed < 1_000) return `${(elapsed / 1_000).toFixed(1)}s`;
  const seconds = Math.floor(elapsed / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}:${String(remainder).padStart(2, '0')}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export interface ReopenableTerminalShell {
  generatedTitle: string;
  customTitle?: string;
  cwd?: string;
}

const RECENTLY_CLOSED_TERMINAL_SHELLS: ReopenableTerminalShell[] = [];
const RECENTLY_CLOSED_TERMINAL_SHELL_LIMIT = 20;

/** Runtime-only LIFO history for Kooky-style Cmd/Ctrl+Shift+T reopening. */
export function recordClosedTerminalShell(shell: ReopenableTerminalShell): void {
  RECENTLY_CLOSED_TERMINAL_SHELLS.push({
    generatedTitle: shell.generatedTitle,
    ...(shell.customTitle ? { customTitle: shell.customTitle } : {}),
    ...(shell.cwd ? { cwd: shell.cwd } : {}),
  });
  if (RECENTLY_CLOSED_TERMINAL_SHELLS.length > RECENTLY_CLOSED_TERMINAL_SHELL_LIMIT) {
    RECENTLY_CLOSED_TERMINAL_SHELLS.splice(
      0,
      RECENTLY_CLOSED_TERMINAL_SHELLS.length - RECENTLY_CLOSED_TERMINAL_SHELL_LIMIT,
    );
  }
}

export function takeRecentlyClosedTerminalShell(): ReopenableTerminalShell | null {
  return RECENTLY_CLOSED_TERMINAL_SHELLS.pop() ?? null;
}

/** Test-only reset; history deliberately never survives an application restart. */
export function clearRecentlyClosedTerminalShells(): void {
  RECENTLY_CLOSED_TERMINAL_SHELLS.length = 0;
}

/** Quote a user-selected terminal snippet as one argument for the current shell. */
export function quoteTerminalAgentPrompt(prompt: string, platform: 'windows' | 'posix'): string {
  if (platform === 'windows') return `'${prompt.replace(/'/g, "''")}'`;
  return `'${prompt.replace(/'/g, "'\"'\"'")}'`;
}

/** Kooky-style Ask Agent launch command, kept independent of React for tests. */
export function terminalAgentLaunchCommand(
  agent: TerminalAgentId,
  prompt: string,
  platform: 'windows' | 'posix',
): string {
  return `${agent} ${quoteTerminalAgentPrompt(prompt, platform)}`;
}

/**
 * Keep one launch directory for the lifetime of a shell run. OSC 7 updates
 * the session's live cwd, but must not change the effect identity and restart
 * the PTY. A deliberate restart adopts the latest reported directory.
 */
export function advanceShellLaunchPath(
  previous: ShellLaunchPathState | null,
  currentPath: string,
  restartNonce: number,
): ShellLaunchPathState {
  if (previous && previous.restartNonce === restartNonce) return previous;
  return { restartNonce, path: currentPath };
}

/** A renderer-owned id prevents delayed events from an older shell run leaking into a restart. */
export function createShellRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Decode OSC 7's file URL form into a local path. POSIX shells commonly emit
 * their machine hostname, which is local and should be ignored. On Windows a
 * non-local authority represents a UNC server and must be preserved.
 */
export function parseOsc7Cwd(payload: string, platform: 'posix' | 'windows' = 'posix'): string | null {
  const value = payload.trim();
  if (!value.startsWith('file://')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return null;
    if (url.username || url.password || url.port || url.search || url.hash) return null;
    const path = decodeURIComponent(url.pathname);
    if (!path) return null;
    const hostname = url.hostname;
    const resolvedPath = platform === 'windows' && hostname && hostname.toLowerCase() !== 'localhost'
      ? `//${hostname}${path}`
      : path;
    if ([...resolvedPath].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })) return null;
    // file:///C:/repo is the Windows spelling. URL.pathname keeps its first
    // slash, while Windows cwd APIs expect C:/repo.
    if (/^\/[A-Za-z]:\//.test(resolvedPath)) return resolvedPath.slice(1);
    return resolvedPath;
  } catch {
    return null;
  }
}

export function shellStateFromExit(event: ShellExitEvent): ShellRuntimeState {
  return event.reason === 'exited' ? 'exited' : 'failed';
}

/**
 * Private OSC 2 marker emitted by JunQi's per-terminal agent shims.
 *
 * The marker rides the terminal byte stream, so it works for every local
 * shell without touching user agent settings. `ended` deliberately maps to
 * null: the status bar returns to ordinary shell chrome when the agent exits.
 */
export function parseJunqiAgentStatusTitle(raw: string): TerminalAgentActivity | null | undefined {
  const value = raw.trim();
  if (!value.startsWith('junqi-agent:')) return undefined;
  const [agent, state] = value.slice('junqi-agent:'.length).split(':', 2);
  if (agent !== 'claude' && agent !== 'codex' && agent !== 'opencode') return undefined;
  if (state === 'running' || state === 'attention') return { agent, state };
  if (state === 'ended') return null;
  return undefined;
}

/** Default titles should yield to the current directory; explicit rename wins. */
export function isGeneratedShellTitle(title: string): boolean {
  return /^Terminal\s+\d+$/i.test(title.trim());
}

/** Empty input clears the manual title override. */
export function normalizeShellCustomTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function migrateShellTitleState(
  value: Record<string, unknown>,
  fallbackGeneratedTitle: string,
): { generatedTitle: string; customTitle?: string } {
  const legacyTitle = normalizeShellCustomTitle(value.title);
  const generatedTitle = normalizeShellCustomTitle(value.generatedTitle)
    ?? (legacyTitle && isGeneratedShellTitle(legacyTitle) ? legacyTitle : fallbackGeneratedTitle);
  const customTitle = normalizeShellCustomTitle(value.customTitle)
    ?? (legacyTitle && !isGeneratedShellTitle(legacyTitle) ? legacyTitle : undefined);
  return {
    generatedTitle,
    ...(customTitle ? { customTitle } : {}),
  };
}

export function resolveShellDisplayTitle({
  customTitle,
  cwd,
  generatedTitle,
}: {
  customTitle?: string;
  cwd?: string;
  generatedTitle: string;
}): string {
  const custom = normalizeShellCustomTitle(customTitle);
  if (custom) return custom;

  const normalizedCwd = cwd?.replace(/[\/\\]+$/, '') ?? '';
  if (!normalizedCwd) return generatedTitle || '~';
  return normalizedCwd.split(/[\/\\]/).pop() || '~';
}
