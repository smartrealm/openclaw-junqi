import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionTargetError,
  createOpenClawGlobalSessionAlias,
  resolveOpenClawSessionTarget,
  scopeOpenClawGlobalSessionRow,
} from './OpenClawSessionTarget';
import { gateway } from './index';

test('会话目标校验去除空白并拒绝缺失值', () => {
  assert.deepEqual(resolveOpenClawSessionTarget('  agent:main:main  '), {
    localKey: 'agent:main:main', key: 'agent:main:main',
  });
  assert.throws(() => resolveOpenClawSessionTarget(''), OpenClawSessionTargetError);
  assert.throws(() => resolveOpenClawSessionTarget('   '), OpenClawSessionTargetError);
  assert.throws(() => resolveOpenClawSessionTarget(undefined), OpenClawSessionTargetError);
});

test('全局会话必须携带经过确认的智能体范围', () => {
  assert.equal(createOpenClawGlobalSessionAlias('legal'), 'agent:legal:global');
  assert.deepEqual(resolveOpenClawSessionTarget('agent:legal:global'), {
    localKey: 'agent:legal:global', key: 'global', agentId: 'legal',
  });
  assert.deepEqual(resolveOpenClawSessionTarget('global', 'legal'), {
    localKey: 'agent:legal:global', key: 'global', agentId: 'legal',
  });
  assert.throws(() => resolveOpenClawSessionTarget('global'), OpenClawSessionTargetError);
  assert.throws(() => resolveOpenClawSessionTarget('agent:legal:global', 'main'), OpenClawSessionTargetError);
});

test('仅以请求智能体范围投影 Gateway 返回的裸全局会话', () => {
  assert.deepEqual(scopeOpenClawGlobalSessionRow({ key: 'global', createdAt: 1 }, 'legal'), {
    key: 'agent:legal:global', createdAt: 1, agentId: 'legal',
  });
  assert.throws(
    () => scopeOpenClawGlobalSessionRow({ key: 'global', agentId: 'main' }, 'legal'),
    OpenClawSessionTargetError,
  );
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
    gateway.setSessionPinned(true, missingTarget),
    gateway.setSessionUnread(true, missingTarget),
    gateway.setSessionArchived(true, missingTarget),
    gateway.setSessionCategory('Finance', missingTarget),
    gateway.getSessionCompactionCheckpoint(missingTarget, 'checkpoint-1'),
    gateway.branchSessionCompactionCheckpoint(missingTarget, 'checkpoint-1'),
    gateway.restoreSessionCompactionCheckpoint(missingTarget, 'checkpoint-1'),
    gateway.listSessionCompactionCheckpoints(missingTarget),
    gateway.rewindSessionAtMessage(missingTarget, 'entry-1'),
    gateway.forkSessionAtMessage(missingTarget, 'entry-1'),
  ];

  for (const request of requests) {
    await assert.rejects(request, OpenClawSessionTargetError);
  }
});
