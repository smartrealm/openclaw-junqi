import type { BusinessAttemptState } from './activityStore';
import type { DingTalkBusinessEvidenceProjection, DingTalkEffect } from './dingtalkTools';

export interface DingTalkInvocationOutcome {
  readonly state: BusinessAttemptState;
  readonly errorCode?: string;
}

export function resolveDingTalkInvocationOutcome(input: {
  readonly effect: DingTalkEffect;
  readonly ok: boolean;
  readonly requiresApproval: boolean;
  readonly errorCode?: string;
  readonly evidence: DingTalkBusinessEvidenceProjection;
}): DingTalkInvocationOutcome {
  if (input.requiresApproval) return { state: 'approval_required' };
  if (!input.ok) {
    return input.effect === 'write'
      ? { state: 'unknown', errorCode: input.errorCode ?? 'DWS_WRITE_RESULT_UNVERIFIED' }
      : { state: 'failed', errorCode: input.errorCode ?? 'OPENCLAW_TOOL_FAILED' };
  }
  if (input.effect !== 'write') return { state: 'succeeded' };
  if (input.evidence.verificationStatus === 'verified') return { state: 'verified' };
  if (input.evidence.verificationStatus === 'succeeded_unverified') {
    return {
      state: 'succeeded_unverified',
      ...(input.evidence.verificationReasonCode
        ? { errorCode: input.evidence.verificationReasonCode }
        : {}),
    };
  }
  return {
    state: 'unknown',
    errorCode: input.evidence.verificationReasonCode ?? 'DWS_WRITE_RESULT_UNVERIFIED',
  };
}
