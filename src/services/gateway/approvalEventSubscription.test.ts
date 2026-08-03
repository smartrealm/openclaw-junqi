import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GatewayCallbacks,
  GatewayConnectionOptions,
} from './Connection';
import {
  GatewayApprovalEventSubscription,
  subscribeGatewayApprovalEvents,
} from './approvalEventBridge';

class FakeApprovalConnection {
  callbacks: GatewayCallbacks | null = null;
  onEvent: (message: unknown) => void = () => {};
  connectCalls: Array<{ url: string; token: string; deviceToken: string }> = [];
  disconnectCalls = 0;

  setCallbacks(callbacks: GatewayCallbacks): void {
    this.callbacks = callbacks;
  }

  connect(url: string, token: string, deviceToken = ''): void {
    this.connectCalls.push({ url, token, deviceToken });
    this.callbacks?.onStatusChange({ connected: true, connecting: false });
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  emit(message: unknown): void {
    this.onEvent(message);
  }
}

function source() {
  return {
    connected: true,
    connectionId: 'gateway-1',
    url: 'ws://127.0.0.1:18789',
    token: 'shared-token',
    deviceToken: 'device-token',
    isConnected() {
      return this.connected;
    },
    getAttestedConnectionId() {
      return this.connectionId;
    },
  };
}

function requestedEvent() {
  return {
    type: 'event',
    event: 'exec.approval.requested',
    payload: {
      id: 'approval-1',
      request: {
        command: 'echo safe',
        allowedDecisions: ['allow-once', 'deny'],
      },
      createdAtMs: 10,
      expiresAtMs: 20,
    },
  };
}

test('keeps a page-lifetime approval socket on the dedicated scope', () => {
  const gatewaySource = source();
  const optionsSeen: GatewayConnectionOptions[] = [];
  const createdConnections: FakeApprovalConnection[] = [];
  const subscription = new GatewayApprovalEventSubscription({
    source: gatewaySource,
    createConnection: (options) => {
      optionsSeen.push(options);
      const created = new FakeApprovalConnection();
      createdConnections.push(created);
      return created;
    },
  });
  const received: string[] = [];
  const unsubscribe = subscribeGatewayApprovalEvents((event) => {
    if (event.phase === 'requested') received.push(event.record.id);
  });

  subscription.start();
  assert.deepEqual(optionsSeen, [{ scopes: ['operator.approvals'], transient: true }]);
  const fake = createdConnections[0];
  assert.ok(fake);
  assert.deepEqual(fake.connectCalls, [{
    url: gatewaySource.url,
    token: gatewaySource.token,
    deviceToken: gatewaySource.deviceToken,
  }]);

  fake.emit(requestedEvent());
  assert.deepEqual(received, ['approval-1']);

  subscription.stop();
  assert.equal(fake.disconnectCalls, 1);
  unsubscribe();
});

test('drops events after the attested source connection changes', () => {
  const gatewaySource = source();
  const fake = new FakeApprovalConnection();
  const subscription = new GatewayApprovalEventSubscription({
    source: gatewaySource,
    createConnection: () => fake,
  });
  const received: string[] = [];
  const unsubscribe = subscribeGatewayApprovalEvents((event) => {
    if (event.phase === 'requested') received.push(event.record.id);
  });

  subscription.start();
  gatewaySource.connectionId = 'gateway-2';
  fake.emit(requestedEvent());

  assert.deepEqual(received, []);
  assert.equal(fake.disconnectCalls, 1);
  unsubscribe();
  subscription.stop();
});
