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

/** A renderer-owned id prevents delayed events from an older shell run leaking into a restart. */
export function createShellRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Decode OSC 7's file URL form into a local path. A hostname is intentionally
 * ignored: a terminal can report `file://localhost/...`, but JunQi's local
 * workspace store only tracks the pathname.
 */
export function parseOsc7Cwd(payload: string): string | null {
  const value = payload.trim();
  if (!value.startsWith('file://')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return null;
    const path = decodeURIComponent(url.pathname);
    if (!path) return null;
    // file:///C:/repo is the Windows spelling. URL.pathname keeps its first
    // slash, while Windows cwd APIs expect C:/repo.
    if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1);
    return path;
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
