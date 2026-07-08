export type DebugScope =
  | 'gateway'
  | 'datastore'
  | 'models'
  | 'app'
  | 'media'
  | 'notifications'
  | 'skills'
  | 'analytics'
  | 'terminal';

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function isDebugLogEnabled(scope: DebugScope): boolean {
  return readFlag('aegis:debug:*') === 'true' || readFlag(`aegis:debug:${scope}`) === 'true';
}

export function debugLog(scope: DebugScope, ...args: unknown[]): void {
  if (isDebugLogEnabled(scope)) console.log(...args);
}

export function debugWarn(scope: DebugScope, ...args: unknown[]): void {
  if (isDebugLogEnabled(scope)) console.warn(...args);
}

export function debugError(scope: DebugScope, ...args: unknown[]): void {
  if (isDebugLogEnabled(scope)) console.error(...args);
}
