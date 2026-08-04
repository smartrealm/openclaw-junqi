import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionTargetError,
  requireOpenClawSessionTarget,
} from './OpenClawSessionTarget';
import { gateway } from './index';

test('会话目标校验去除空白并拒绝缺失值', () => {
  assert.equal(requireOpenClawSessionTarget('  agent:main:main  '), 'agent:main:main');
  assert.throws(() => requireOpenClawSessionTarget(''), OpenClawSessionTargetError);
  assert.throws(() => requireOpenClawSessionTarget('   '), OpenClawSessionTargetError);
  assert.throws(() => requireOpenClawSessionTarget(undefined), OpenClawSessionTargetError);
});

test('Gateway 发送外观在连接或 pending-send 状态之前拒绝空会话目标', async () => {
  await assert.rejects(
    gateway.sendMessage('不能发送', undefined, '  '),
    OpenClawSessionTargetError,
  );
});

test('Gateway 会话定向外观在连接或 mutation 协调器前拒绝缺失目标', async () => {
  const missingTarget = undefined as unknown as string;
  const requests = [
    gateway.describeSession(missingTarget),
    gateway.getEffectiveTools(missingTarget),
    gateway.getSessionPreview(missingTarget),
    gateway.resolveSessionKey(missingTarget),
    gateway.listSessionArtifacts(missingTarget),
    gateway.getSessionArtifact('artifact-1', missingTarget),
    gateway.downloadSessionArtifact('artifact-1', missingTarget),
    gateway.getHistory(missingTarget),
    gateway.getMessage(missingTarget, 'message-1'),
    gateway.compactSession(missingTarget),
    gateway.deleteSession(missingTarget),
    gateway.resetSession(missingTarget),
    gateway.deleteSessionFenced(missingTarget, true, 'session-1', 'connection-1'),
    gateway.resetSessionFenced(missingTarget, 'connection-1'),
  ];

  for (const request of requests) {
    await assert.rejects(request, OpenClawSessionTargetError);
  }
});
