import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawSessionCompanionBusyError,
  OpenClawSessionCompanionClient,
  OpenClawSessionCompanionResponseError,
  OpenClawSessionCompanionUnavailableError,
  parseOpenClawSessionCompanionState,
} from './OpenClawSessionCompanionClient';

test('session companion client uses fenced official RPC methods and bounded responses', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawSessionCompanionClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      if (method === 'sessions.companion.state') return { exchanges: [{ question: 'What changed?', answer: 'One file changed.', ts: 1 }] };
      if (method === 'sessions.companion.ask') return { answer: 'One file changed.', ts: 2 };
      return { ok: true };
    },
  });

  assert.deepEqual(await client.getState('agent:main:main'), {
    exchanges: [{ question: 'What changed?', answer: 'One file changed.', ts: 1 }],
  });
  assert.deepEqual(await client.ask('agent:main:main', 'What changed?'), { answer: 'One file changed.', ts: 2 });
  await client.reset('agent:main:main');
  assert.deepEqual(calls, [
    { method: 'sessions.companion.state', params: { sessionKey: 'agent:main:main' }, connectionId: 'gateway-a' },
    { method: 'sessions.companion.ask', params: { sessionKey: 'agent:main:main', question: 'What changed?' }, connectionId: 'gateway-a' },
    { method: 'sessions.companion.reset', params: { sessionKey: 'agent:main:main' }, connectionId: 'gateway-a' },
  ]);
});

test('session companion client rejects malformed output and maps busy or unavailable responses', async () => {
  assert.throws(
    () => parseOpenClawSessionCompanionState({ exchanges: [{ question: 'q', answer: 'a', ts: -1 }] }),
    OpenClawSessionCompanionResponseError,
  );
  const busy = new OpenClawSessionCompanionClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayRpcError('busy', 'UNAVAILABLE', { code: 'SESSION_COMPANION_BUSY' }); },
  });
  const unavailable = new OpenClawSessionCompanionClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });
  await assert.rejects(busy.ask('agent:main:main', 'Question'), OpenClawSessionCompanionBusyError);
  await assert.rejects(unavailable.getState('agent:main:main'), OpenClawSessionCompanionUnavailableError);
});
