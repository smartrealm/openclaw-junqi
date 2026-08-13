import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  currentAttestedConnectionId,
  GatewayConnectionSettlementAbortedError,
  GatewayConnectionSettlementTimeoutError,
  GatewayConnectionSettlementFailureError,
  waitForGatewayConnectionSettlement,
  type GatewayConnectionSettlementSource,
} from './GatewayConnectionSettlement';

function identity(connectionId: string, verified = true): RuntimeIdentity {
  return { connectionId, verified } as RuntimeIdentity;
}

function sourceFixture() {
  let connectionId: string | null = 'old';
  let pendingConnectionId: string | null = null;
  let runtimeIdentity: RuntimeIdentity | null = identity('old');
  const listeners = new Set<(value: RuntimeIdentity | null) => void>();
  const failureListeners = new Set<(diagnostic: string) => void>();
  const availabilityListeners = new Set<() => void>();
  const source: GatewayConnectionSettlementSource = {
    captureConnectionId: () => connectionId,
    capturePendingConnectionId: () => pendingConnectionId,
    isConnectionCurrent: (candidate) => candidate === connectionId,
    getRuntimeIdentity: () => runtimeIdentity,
    subscribeRuntimeIdentity(listener) {
      listeners.add(listener);
      listener(runtimeIdentity);
      return () => listeners.delete(listener);
    },
    subscribeFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
  };
  return {
    source,
    publish(nextConnectionId: string | null, nextIdentity: RuntimeIdentity | null) {
      connectionId = nextConnectionId;
      pendingConnectionId = null;
      runtimeIdentity = nextIdentity;
      listeners.forEach((listener) => listener(runtimeIdentity));
    },
    publishPending(nextConnectionId: string, nextIdentity: RuntimeIdentity | null) {
      connectionId = null;
      pendingConnectionId = nextConnectionId;
      runtimeIdentity = nextIdentity;
      listeners.forEach((listener) => listener(runtimeIdentity));
    },
    fail(diagnostic: string) {
      failureListeners.forEach((listener) => listener(diagnostic));
    },
    publishAvailability() {
      availabilityListeners.forEach((listener) => listener());
    },
  };
}

test('统一连接门禁等待新的已核验 Gateway 连接', async () => {
  const fixture = sourceFixture();
  const settled = waitForGatewayConnectionSettlement({
    source: fixture.source,
    previousConnectionId: 'old',
    timeoutMs: 1_000,
  });

  fixture.publish(null, null);
  fixture.publish('new', identity('old'));
  fixture.publish('new', identity('new'));

  assert.equal(await settled, 'new');
});

test('统一连接门禁不会把旧连接当作重启完成', async () => {
  const fixture = sourceFixture();
  await assert.rejects(
    waitForGatewayConnectionSettlement({
      source: fixture.source,
      previousConnectionId: 'old',
      timeoutMs: 5,
    }),
    (error: unknown) => error instanceof GatewayConnectionSettlementTimeoutError,
  );
});

test('统一连接门禁直接返回传输层终态失败而不是等待通用超时', async () => {
  const fixture = sourceFixture();
  const settlement = waitForGatewayConnectionSettlement({
    source: fixture.source,
    previousConnectionId: 'old',
    timeoutMs: 1_000,
  });

  fixture.fail('selected runtime credential is unavailable');

  await assert.rejects(
    settlement,
    (error: unknown) => error instanceof GatewayConnectionSettlementFailureError
      && /credential is unavailable/.test(error.message),
  );
});

test('新连接的运行时身份核验失败时立即保留具体问题', async () => {
  const fixture = sourceFixture();
  const settlement = waitForGatewayConnectionSettlement({
    source: fixture.source,
    previousConnectionId: 'old',
    timeoutMs: 1_000,
  });
  fixture.publish('new', {
    ...identity('new', false),
    issues: ['runtime_path_mismatch'],
  });

  await assert.rejects(
    settlement,
    (error: unknown) => error instanceof GatewayConnectionSettlementFailureError
      && /runtime_path_mismatch/.test(error.message),
  );
});

test('握手尚未公开为已连接时也能立即收敛身份核验失败', async () => {
  const fixture = sourceFixture();
  const settlement = waitForGatewayConnectionSettlement({
    source: fixture.source,
    previousConnectionId: 'old',
    timeoutMs: 1_000,
  });
  fixture.publishPending('pending-new', {
    ...identity('pending-new', false),
    issues: ['runtime_path_mismatch'],
  });

  await assert.rejects(
    settlement,
    (error: unknown) => error instanceof GatewayConnectionSettlementFailureError
      && /runtime_path_mismatch/.test(error.message),
  );
});

test('当前连接只有通过连接围栏和运行时身份核验后才可继续安装', () => {
  const fixture = sourceFixture();

  assert.equal(currentAttestedConnectionId(fixture.source), 'old');
  fixture.publish('new', identity('old'));
  assert.equal(currentAttestedConnectionId(fixture.source), null);
  fixture.publish('new', identity('new', false));
  assert.equal(currentAttestedConnectionId(fixture.source), null);
  fixture.publish('new', identity('new'));
  assert.equal(currentAttestedConnectionId(fixture.source), 'new');
});

test('身份先完成而传输状态稍后开放时连接门禁会重新检查', async () => {
  const fixture = sourceFixture();
  let connectionAvailable = false;
  const source = {
    ...fixture.source,
    isConnectionCurrent: (connectionId: string) => connectionAvailable && connectionId === 'new',
  };
  const settlement = waitForGatewayConnectionSettlement({
    source,
    previousConnectionId: 'old',
    timeoutMs: 1_000,
  });

  fixture.publish('new', identity('new'));
  connectionAvailable = true;
  fixture.publishAvailability();

  assert.equal(await settlement, 'new');
});

test('交接取消立即终止连接收敛且后续身份事件不能改写结果', async () => {
  const fixture = sourceFixture();
  const controller = new AbortController();
  const settlement = waitForGatewayConnectionSettlement({
    source: fixture.source,
    previousConnectionId: 'old',
    timeoutMs: 1_000,
    signal: controller.signal,
  });

  controller.abort();
  fixture.publish('new', identity('new'));

  await assert.rejects(
    settlement,
    (error: unknown) => error instanceof GatewayConnectionSettlementAbortedError,
  );
});
