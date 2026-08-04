export class OpenClawSessionTargetError extends Error {
  readonly code = 'OPENCLAW_SESSION_TARGET_REQUIRED';

  constructor() {
    super('OPENCLAW_SESSION_TARGET_REQUIRED');
    this.name = 'OpenClawSessionTargetError';
  }
}

export function requireOpenClawSessionTarget(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) throw new OpenClawSessionTargetError();
  return key;
}
