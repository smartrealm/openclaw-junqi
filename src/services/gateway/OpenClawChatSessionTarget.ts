export class OpenClawChatSessionTargetError extends Error {
  readonly code = 'OPENCLAW_CHAT_SESSION_TARGET_REQUIRED';

  constructor() {
    super('OPENCLAW_CHAT_SESSION_TARGET_REQUIRED');
    this.name = 'OpenClawChatSessionTargetError';
  }
}

export function requireOpenClawChatSessionTarget(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) throw new OpenClawChatSessionTargetError();
  return key;
}
