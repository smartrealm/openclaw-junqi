import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSessionModelSelectionAllowed,
  sessionSettingsErrorMessage,
  SessionModelSelectionLockedError,
  resolveSessionAgentRuntimePatch,
  resolveSessionThinkingPatch,
} from './useSessionRuntimeSettings';
import {
  SessionSettingsTargetError,
  type SessionPatchResult,
} from '@/services/gateway/SessionSettingsClient';

function patchResult(thinkingLevel: unknown): SessionPatchResult {
  return {
    ok: true,
    key: 'agent:main:main',
    entry: { thinkingLevel },
    resolved: { modelProvider: 'openai', model: 'gpt-5.6' },
  };
}

test('思考设置仅以 Gateway 确认回执回写目标会话', () => {
  assert.equal(resolveSessionThinkingPatch(patchResult(' xhigh ')), 'xhigh');
  assert.equal(resolveSessionThinkingPatch(patchResult(null)), null);
  assert.throws(
    () => resolveSessionThinkingPatch(patchResult({ id: 'high' })),
    /SESSION_SETTINGS_RESPONSE_INVALID/,
  );
});

test('模型回执仅在 Gateway 确认有效 runtime 时提供本地投影', () => {
  const confirmed = patchResult(null);
  confirmed.resolved.agentRuntime = { id: 'codex', source: 'model' };
  assert.deepEqual(resolveSessionAgentRuntimePatch(confirmed), { id: 'codex' });

  const omitted = patchResult(null);
  assert.equal(resolveSessionAgentRuntimePatch(omitted), null);

  const malformed = patchResult(null);
  malformed.resolved.agentRuntime = { id: '' };
  assert.equal(resolveSessionAgentRuntimePatch(malformed), null);
});

test('模型锁定会话拒绝模型变更与恢复默认模型', () => {
  assert.doesNotThrow(() => assertSessionModelSelectionAllowed(false, true));
  assert.doesNotThrow(() => assertSessionModelSelectionAllowed(true, false));
  assert.throws(
    () => assertSessionModelSelectionAllowed(true, true),
    SessionModelSelectionLockedError,
  );
});

test('缺少活动会话时使用本地化设置错误，不伪造主会话目标', () => {
  assert.equal(
    sessionSettingsErrorMessage(
      new SessionSettingsTargetError(),
      'fallback',
      'invalid',
      'locked',
      'target-required',
    ),
    'target-required',
  );
});
