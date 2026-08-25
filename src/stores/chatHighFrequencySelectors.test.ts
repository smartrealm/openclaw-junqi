import assert from 'node:assert/strict';
import test from 'node:test';
import { shallow } from 'zustand/shallow';
import { useChatStore } from './chatStore';
import type { ChatMessage } from './chatStore';
import {
  selectAppChatRuntime,
  selectMessageInputRuntime,
} from './chatHighFrequencySelectors';

test('草稿输入不改变应用运行态与输入框非文本依赖的订阅投影', () => {
  const state = useChatStore.getState();
  const sessionKey = state.activeSessionKey;
  const previousDraft = state.getDraft(sessionKey);
  const appBefore = selectAppChatRuntime(state);
  const inputBefore = selectMessageInputRuntime(state);

  try {
    state.setDraft(sessionKey, `${previousDraft}输入法组合文本`);
    const updated = useChatStore.getState();

    assert.equal(shallow(appBefore, selectAppChatRuntime(updated)), true);
    assert.equal(shallow(inputBefore, selectMessageInputRuntime(updated)), true);
  } finally {
    useChatStore.getState().setDraft(sessionKey, previousDraft);
  }
});

test('助手流式增量不改变输入框运行投影', () => {
  const state = useChatStore.getState();
  const assistant: ChatMessage = {
    id: 'selector-streaming-assistant',
    role: 'assistant',
    content: '第一段',
    timestamp: '2026-08-25T00:00:00.000Z',
    isStreaming: true,
  };
  const before = {
    ...state,
    messages: [...state.messages, assistant],
  };
  const after = {
    ...before,
    messages: [
      ...state.messages,
      { ...assistant, content: '第一段与第二段' },
    ],
  };

  assert.equal(shallow(
    selectMessageInputRuntime(before),
    selectMessageInputRuntime(after),
  ), true);
});
