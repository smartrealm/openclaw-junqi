import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionMutationGate } from './sessionMutationGate';

test('已登记发送完成 Gateway 准入前，会话变更不得开始', async () => {
  const sessionKey = 'agent:main:send-admission-order';
  const releaseSend = sessionMutationGate.tryAcquireSend(sessionKey);
  assert.ok(releaseSend);
  let mutationStarted = false;
  const mutation = sessionMutationGate.run(sessionKey, async () => {
    mutationStarted = true;
  });

  assert.equal(sessionMutationGate.tryAcquireSend(sessionKey), null);
  await Promise.resolve();
  assert.equal(mutationStarted, false);

  releaseSend();
  await mutation;
  assert.equal(mutationStarted, true);

  const releaseAfterMutation = sessionMutationGate.tryAcquireSend(sessionKey);
  assert.ok(releaseAfterMutation);
  releaseAfterMutation();
});
