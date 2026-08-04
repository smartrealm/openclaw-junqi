import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawChatSessionTargetError,
  requireOpenClawChatSessionTarget,
} from './OpenClawChatSessionTarget';
import { gateway } from './index';

test('会话目标校验去除空白并拒绝缺失值', () => {
  assert.equal(requireOpenClawChatSessionTarget('  agent:main:main  '), 'agent:main:main');
  assert.throws(() => requireOpenClawChatSessionTarget(''), OpenClawChatSessionTargetError);
  assert.throws(() => requireOpenClawChatSessionTarget('   '), OpenClawChatSessionTargetError);
  assert.throws(() => requireOpenClawChatSessionTarget(undefined), OpenClawChatSessionTargetError);
});

test('Gateway 发送外观在连接或 pending-send 状态之前拒绝空会话目标', async () => {
  await assert.rejects(
    gateway.sendMessage('不能发送', undefined, '  '),
    OpenClawChatSessionTargetError,
  );
});
