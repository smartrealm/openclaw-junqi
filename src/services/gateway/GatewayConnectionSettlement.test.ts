import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  currentAttestedConnectionId,
  GatewayConnectionSettlementTimeoutError,
  waitForGatewayConnectionSettlement,
  type GatewayConnectionSettlementSource,
} from './GatewayConnectionSettlement';

function identity(connectionId: string, verified = true): RuntimeIdentity {
  return { connectionId, verified } as RuntimeIdentity;
}

function sourceFixture() {
  let connectionId: string | null = 'old';
  let runtimeIdentity: RuntimeIdentity | null = identity('old');
  const listeners = new Set<(value: RuntimeIdentity | null) => void>();
  const source: GatewayConnectionSettlementSource = {
    captureConnectionId: () => connectionId,
    isConnectionCurrent: (candidate) => candidate === connectionId,
    getRuntimeIdentity: () => runtimeIdentity,
    subscribeRuntimeIdentity(listener) {
      listeners.add(listener);
      listener(runtimeIdentity);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    publish(nextConnectionId: string | null, nextIdentity: RuntimeIdentity | null) {
      connectionId = nextConnectionId;
      runtimeIdentity = nextIdentity;
      listeners.forEach((listener) => listener(runtimeIdentity));
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
  fixture.publish('new', identity('new', false));
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
