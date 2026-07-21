import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePersonaIntoDraft } from './personaDraft';

test('CHAT-07 persona becomes a visible, editable draft instruction', () => {
  const draft = mergePersonaIntoDraft('原有问题', { label: '审查员', prompt: '逐项核对事实。' });
  assert.equal(draft, '会话指令（审查员）：\n逐项核对事实。\n\n原有问题');
  assert.equal(mergePersonaIntoDraft(draft, { label: '审查员', prompt: '逐项核对事实。' }), draft);
});
