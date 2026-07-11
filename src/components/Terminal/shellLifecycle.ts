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
}

export interface ShellLaunchPathState {
  restartNonce: number;
  path: string;
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

/** Default titles should yield to the current directory; explicit rename wins. */
export function isGeneratedShellTitle(title: string): boolean {
  return /^Terminal\s+\d+$/i.test(title.trim());
}
