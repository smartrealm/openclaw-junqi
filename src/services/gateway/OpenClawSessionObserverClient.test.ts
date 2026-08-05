import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError } from './Connection';
import {
  OPENCLAW_SESSION_OBSERVER_VISIBILITY_METHOD,
  OpenClawSessionObserverClient,
} from './OpenClawSessionObserverClient';

test('declares observer visibility through the fenced Gateway method', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawSessionObserverClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return { ok: true };
    },
  });

  assert.equal(await client.setVisible(true), 'applied');
  assert.equal(await client.setVisible(true), 'applied');
  assert.equal(await client.setVisible(false), 'applied');
  assert.deepEqual(calls, [
    { method: OPENCLAW_SESSION_OBSERVER_VISIBILITY_METHOD, params: { visible: true }, connectionId: 'gateway-a' },
    { method: OPENCLAW_SESSION_OBSERVER_VISIBILITY_METHOD, params: { visible: false }, connectionId: 'gateway-a' },
  ]);
});

test('treats an unavailable connection as unapplied only when visibility is required', async () => {
  const client = new OpenClawSessionObserverClient({
    captureConnectionId: () => null,
    isConnectionCurrent: () => false,
    requestFenced: async () => { throw new Error('must not request'); },
  });

  assert.equal(await client.setVisible(true), 'unavailable');
  assert.equal(await client.setVisible(false), 'applied');
});

test('does not retain visibility after a fenced disconnect response', async () => {
  const client = new OpenClawSessionObserverClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  assert.equal(await client.setVisible(true), 'unavailable');
});
