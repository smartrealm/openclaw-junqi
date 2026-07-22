export type TerminalProxyUnsetShell = 'posix' | 'powershell';

/**
 * Builds the current shell's real proxy-clear command from a captured
 * `name=value` environment entry. Only valid environment names are accepted.
 */
export function buildTerminalProxyUnsetInput(
  entry: string,
  shell: TerminalProxyUnsetShell,
): string | null {
  const separator = entry.indexOf('=');
  if (separator <= 0) return null;

  const name = entry.slice(0, separator);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;

  const upper = name.toUpperCase();
  if (shell === 'powershell') {
    return `$env:${name} = $null; $env:${upper} = $null\r`;
  }
  return `unset ${name} ${upper}\r`;
}
