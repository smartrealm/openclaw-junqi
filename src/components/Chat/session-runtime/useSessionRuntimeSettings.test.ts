import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSessionThinkingPatch,
} from './useSessionRuntimeSettings';
import type { SessionPatchResult } from '@/services/gateway/SessionSettingsClient';

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
