export type SessionActionErrorKey =
  | 'chat.sessionActionResponseInvalid'
  | 'chat.sessionActionUnsupported'
  | 'chat.sessionActionFailed';

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** 内部协议码只用于选择可操作提示，不直接进入面向用户的通知。 */
export function sessionActionErrorKey(error: unknown): SessionActionErrorKey {
  const code = errorCode(error);
  if (code === 'SESSION_ORGANIZATION_RESPONSE_INVALID') {
    return 'chat.sessionActionResponseInvalid';
  }
  if (code === 'SESSION_ORGANIZATION_PROTOCOL_UNSUPPORTED') {
    return 'chat.sessionActionUnsupported';
  }
  return 'chat.sessionActionFailed';
}
