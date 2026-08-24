import type { DingTalkAuditFailureKind } from '@/business-applications/dingtalkAuditAvailability';

export type BusinessActivityPrimaryState =
  | { kind: 'loading' }
  | { kind: 'failure'; failure: DingTalkAuditFailureKind }
  | { kind: 'empty' }
  | { kind: 'content' };

export function resolveBusinessActivityPrimaryState(input: {
  hasAnyActivity: boolean;
  loading: boolean;
  failure: DingTalkAuditFailureKind | null;
}): BusinessActivityPrimaryState {
  if (input.hasAnyActivity) return { kind: 'content' };
  if (input.loading) return { kind: 'loading' };
  if (input.failure) return { kind: 'failure', failure: input.failure };
  return { kind: 'empty' };
}
