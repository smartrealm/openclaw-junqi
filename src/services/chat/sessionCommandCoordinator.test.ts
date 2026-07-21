import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionCommandCoordinator } from './sessionCommandCoordinator';

test('CHAT-10 send barrier waits for the preceding session mutation', async () => {
  const coordinator = new SessionCommandCoordinator();
  const events: string[] = [];
  let release!: () => void;
  const mutation = coordinator.runMutation('session-a', async () => {
    events.push('mutation:start');
    await new Promise<void>((resolve) => { release = resolve; });
    events.push('mutation:end');
  });
  const sendBarrier = coordinator.waitForPending('session-a').then(() => events.push('send'));

  await Promise.resolve();
  assert.deepEqual(events, ['mutation:start']);
  release();
  await Promise.all([mutation, sendBarrier]);
  assert.deepEqual(events, ['mutation:start', 'mutation:end', 'send']);
});

test('CHAT-10 different sessions do not block each other', async () => {
  const coordinator = new SessionCommandCoordinator();
  let release!: () => void;
  void coordinator.runMutation('session-a', () => new Promise<void>((resolve) => { release = resolve; }));
  await coordinator.waitForPending('session-b');
  assert.equal(coordinator.hasPending('session-a'), true);
  release();
});
