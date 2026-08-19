import { GatewayRpcError } from '@/services/gateway/Connection';
import { OpenClawAuditUnsupportedError } from '@/services/gateway/OpenClawAuditClient';
import type { OpenClawAuditListInput } from '@/services/gateway/OpenClawAuditClient';
import { OpenClawAuditResponseError } from '@/services/gateway/OpenClawAuditActivityCodec';

export type DingTalkAuditFailureKind =
  | 'disconnected'
  | 'session-missing'
  | 'unsupported'
  | 'unauthorized'
  | 'invalid-response'
  | 'failed';

export function buildDingTalkAuditQuery(
  sessionKey: string,
  cursor?: string,
): OpenClawAuditListInput | null {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return null;
  return {
    kind: 'tool_action',
    sessionKey: normalizedSessionKey,
    limit: 100,
    ...(cursor ? { cursor } : {}),
  };
}

export function classifyDingTalkAuditFailure(
  connected: boolean,
  error: unknown,
): DingTalkAuditFailureKind {
  if (!connected) return 'disconnected';
  if (error instanceof OpenClawAuditUnsupportedError) return 'unsupported';
  if (error instanceof GatewayRpcError && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN')) {
    return 'unauthorized';
  }
  if (error instanceof OpenClawAuditResponseError) return 'invalid-response';
  return 'failed';
}
