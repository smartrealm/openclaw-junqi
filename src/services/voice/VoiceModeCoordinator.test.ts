import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceModeCoordinator } from './VoiceModeCoordinator';

const context = { sessionKey: 'agent:main:main', connectionId: 'connection-a' };

test('Talk 模式以准备状态启动并只接受所属轮次的状态转换', () => {
  const coordinator = new VoiceModeCoordinator();
  const started = coordinator.start({ context });

  assert.equal(started.mode, 'talk');
  assert.equal(started.phase, 'preparing');
  assert.ok(started.turnId);
  assert.equal(coordinator.transition(started.turnId, context, 'listening'), true);
  assert.equal(coordinator.transition('stale-turn', context, 'speaking'), false);
  assert.equal(coordinator.getSnapshot().phase, 'listening');
});

test('无可信 Gateway 上下文时进入可关闭的错误状态', () => {
  const coordinator = new VoiceModeCoordinator();
  const snapshot = coordinator.start({ context: null });

  assert.equal(snapshot.mode, 'talk');
  assert.equal(snapshot.phase, 'error');
  assert.equal(snapshot.error, 'gateway_unavailable');
  assert.equal(snapshot.turnId, null);
});

test('目标变化会围栏旧轮次且旧回调不能恢复状态', () => {
  const coordinator = new VoiceModeCoordinator();
  const started = coordinator.start({ context });
  const nextContext = { sessionKey: 'agent:other:main', connectionId: 'connection-a' };

  assert.equal(coordinator.invalidateContext(nextContext), true);
  assert.equal(coordinator.getSnapshot().error, 'target_changed');
  assert.equal(coordinator.transition(started.turnId, context, 'listening'), false);
});

test('Stop 先围栏模式并且并发调用只执行一次资源释放事务', async () => {
  const coordinator = new VoiceModeCoordinator();
  const observations: string[] = [];
  let release: (() => void) | undefined;
  coordinator.start({ context });
  coordinator.subscribeResourceRelease(() => new Promise<void>((resolve) => {
    observations.push(coordinator.getSnapshot().phase);
    release = resolve;
  }));

  const first = coordinator.stopAndReleaseResources();
  const second = coordinator.stopAndReleaseResources();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(observations, ['off']);
  release?.();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(coordinator.getSnapshot().mode, 'off');
});

test('只有当前所属轮次可以触发带资源释放的停止', async () => {
  const coordinator = new VoiceModeCoordinator();
  let releases = 0;
  const started = coordinator.start({ context });
  coordinator.subscribeResourceRelease(() => { releases += 1; });

  assert.equal(await coordinator.stopOwnedTurnAndReleaseResources('stale', context), false);
  assert.equal(releases, 0);
  assert.equal(await coordinator.stopOwnedTurnAndReleaseResources(started.turnId, context), true);
  assert.equal(releases, 1);
});
