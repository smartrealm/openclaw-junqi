export const TERMINAL_WORKSPACE_PATH_MIME = 'application/x-junqi-terminal-workspace-path';

const MAX_PATH_PAYLOAD_LENGTH = 32 * 1024;

export interface TerminalWorkspacePathDrop {
  path: string;
  projectPath: string;
}

function validPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_PATH_PAYLOAD_LENGTH
    && !value.includes('\0');
}

/**
 * Decode the app-private browser drag payload. The Rust command still checks
 * that `path` is within `projectPath`; this parser only keeps malformed DOM
 * data from reaching an IPC call.
 */
export function parseTerminalWorkspacePathDrop(raw: string): TerminalWorkspacePathDrop | null {
  if (!raw || raw.length > MAX_PATH_PAYLOAD_LENGTH * 2) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (!validPath(candidate.path) || !validPath(candidate.projectPath)) return null;
    return {
      path: candidate.path,
      projectPath: candidate.projectPath,
    };
  } catch {
    return null;
  }
}

export function serializeTerminalWorkspacePathDrop(payload: TerminalWorkspacePathDrop): string {
  return JSON.stringify({
    path: payload.path,
    projectPath: payload.projectPath,
  });
}
