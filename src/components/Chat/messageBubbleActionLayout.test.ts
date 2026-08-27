import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveMessageBubbleActionLayout } from './messageBubbleActionLayout';

test('已持久化用户消息按意图和风险分层展示操作', () => {
  assert.deepEqual(resolveMessageBubbleActionLayout({
    canEditAndResend: true,
    canFork: true,
    previewable: false,
  }), {
    primary: 'editAndResend',
    direct: ['copy'],
    overflow: ['fork'],
  });
});

test('预览保持直接操作且不会改变会话结构操作层级', () => {
  assert.deepEqual(resolveMessageBubbleActionLayout({
    canEditAndResend: false,
    canFork: false,
    previewable: true,
  }), {
    primary: null,
    direct: ['preview', 'copy'],
    overflow: [],
  });
});

test('所有语言都使用用户意图文案且不再暴露重绕术语', () => {
  for (const language of ['en', 'zh', 'zh-TW']) {
    const locale = JSON.parse(readFileSync(
      new URL(`../../locales/${language}.json`, import.meta.url),
      'utf8',
    )) as { chat?: { messageCut?: Record<string, unknown> } };
    const messageCut = locale.chat?.messageCut;

    assert.equal(typeof messageCut?.editAndResend, 'string');
    assert.equal(typeof messageCut?.moreActions, 'string');
    assert.equal(typeof messageCut?.disabledAction, 'string');
    assert.equal(messageCut?.rewind, undefined);
  }
});
