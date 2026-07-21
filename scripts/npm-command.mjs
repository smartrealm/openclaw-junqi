import { execFileSync } from 'node:child_process';

/**
 * Executes the npm CLI through the platform's supported command boundary.
 * Windows exposes npm as a .cmd shim, which Node cannot execute directly
 * through execFileSync.
 */
export function runNpmCommand(args, options = {}) {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'npm.cmd' : 'npm', args, {
    ...options,
    shell: windows,
  });
}
