import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDingTalkInvocationOutcome } from './dingtalkInvocationOutcome';
import type { DingTalkBusinessEvidenceProjection } from './dingtalkTools';

function evidence(
  verificationStatus: DingTalkBusinessEvidenceProjection['verificationStatus'],
  verificationReasonCode: string | null = null,
): DingTalkBusinessEvidenceProjection {
  return {
    dwsCanonicalPath: null,
    schemaDigest: null,
    recoveryEventId: null,
    verificationStatus,
    verifierToolName: null,
    verifierCanonicalPath: null,
    verifierSchemaDigest: null,
    resourceId: null,
    verificationReasonCode,
  };
}

test('只读成功保持普通完成状态', () => {
  assert.deepEqual(resolveDingTalkInvocationOutcome({
    effect: 'read',
    ok: true,
    requiresApproval: false,
    evidence: evidence(null),
  }), { state: 'succeeded' });
});

test('写操作只有正式核验结果才能进入已核验状态', () => {
  assert.deepEqual(resolveDingTalkInvocationOutcome({
    effect: 'write',
    ok: true,
    requiresApproval: false,
    evidence: evidence('verified'),
  }), { state: 'verified' });
  assert.deepEqual(resolveDingTalkInvocationOutcome({
    effect: 'write',
    ok: true,
    requiresApproval: false,
    evidence: evidence('succeeded_unverified', 'DWS_WRITE_POSTCONDITION_NOT_DECLARED'),
  }), {
    state: 'succeeded_unverified',
    errorCode: 'DWS_WRITE_POSTCONDITION_NOT_DECLARED',
  });
});

test('旧插件或失败写响应缺少核验证据时保持未知', () => {
  assert.deepEqual(resolveDingTalkInvocationOutcome({
    effect: 'write',
    ok: true,
    requiresApproval: false,
    evidence: evidence(null),
  }), { state: 'unknown', errorCode: 'DWS_WRITE_RESULT_UNVERIFIED' });
  assert.deepEqual(resolveDingTalkInvocationOutcome({
    effect: 'write',
    ok: false,
    requiresApproval: false,
    errorCode: 'DWS_SIDE_EFFECT_UNVERIFIED',
    evidence: evidence(null),
  }), { state: 'unknown', errorCode: 'DWS_SIDE_EFFECT_UNVERIFIED' });
});
