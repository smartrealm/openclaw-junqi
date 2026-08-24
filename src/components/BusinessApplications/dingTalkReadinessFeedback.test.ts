import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldHideDingTalkReadinessPanel } from './dingTalkReadinessFeedback';

test('接入状态就绪时仍保留插件错误和授权结果', () => {
  assert.equal(shouldHideDingTalkReadinessPanel(true, true, null, null), true);
  assert.equal(shouldHideDingTalkReadinessPanel(true, true, '插件不可修改', null), false);
  assert.equal(shouldHideDingTalkReadinessPanel(true, true, null, '授权已写入'), false);
});
