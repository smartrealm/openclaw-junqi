import assert from 'node:assert/strict';
import test from 'node:test';
import { useChatStore } from '@/stores/chatStore';
import { stageBusinessChatRequest } from './businessChatBridge';

test('business chat request stages a visible draft and preserves existing user text', () => {
  const state = useChatStore.getState();
  const key = state.activeSessionKey;
  state.setDraft(key, 'Existing draft');

  stageBusinessChatRequest(
    { integrationId: 'dingtalk-workspace', capabilityId: 'approvals' },
    'Plan an approval operation.',
  );

  assert.equal(useChatStore.getState().getDraft(key), 'Existing draft\n\nPlan an approval operation.');
  useChatStore.getState().setDraft(key, '');
});
