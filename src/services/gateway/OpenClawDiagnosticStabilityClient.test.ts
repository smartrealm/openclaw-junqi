import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawDiagnosticStabilityClient,
  OpenClawDiagnosticStabilityResponseError,
  OpenClawDiagnosticStabilityUnavailableError,
  parseOpenClawDiagnosticStability,
} from './OpenClawDiagnosticStabilityClient';

const response = {
  generatedAt: '2026-08-04T00:00:00.000Z',
  capacity: 1_000,
  count: 2,
  dropped: 1,
  firstSeq: 12,
  lastSeq: 13,
  events: [
    { seq: 12, ts: 1_754_265_600_000, type: 'message.queued', channel: 'discord', source: 'webhook' },
    { seq: 13, ts: 1_754_265_601_000, type: 'session.state', outcome: 'idle', raw: 'omit' },
  ],
  summary: {
    byType: { 'message.queued': 1, 'session.state': 1 },
    memory: { latest: { rssBytes: 1 }, pressureCount: 0 },
  },
  internalRecorderState: { preserve: false },
};

test('OpenClawDiagnosticStabilityClient fences and projects only the stable diagnostic metadata', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawDiagnosticStabilityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });

  const snapshot = await client.get();

  assert.deepEqual(calls, [{ method: 'diagnostics.stability', params: {}, connectionId: 'gateway-a' }]);
  assert.deepEqual(snapshot, {
    generatedAt: '2026-08-04T00:00:00.000Z',
    capacity: 1_000,
    count: 2,
    dropped: 1,
    firstSeq: 12,
    lastSeq: 13,
    events: [
      { seq: 12, ts: 1_754_265_600_000, type: 'message.queued' },
      { seq: 13, ts: 1_754_265_601_000, type: 'session.state' },
    ],
    byType: { 'message.queued': 1, 'session.state': 1 },
  });
  assert.equal('internalRecorderState' in snapshot, false);
  assert.equal('channel' in snapshot.events[0], false);
  assert.equal('memory' in snapshot, false);
});

test('OpenClawDiagnosticStabilityClient rejects malformed known snapshot fields', () => {
  assert.throws(() => parseOpenClawDiagnosticStability({ ...response, count: -1 }), OpenClawDiagnosticStabilityResponseError);
  assert.throws(() => parseOpenClawDiagnosticStability({ ...response, events: [{ seq: 1, ts: 'now', type: 'message.queued' }] }), OpenClawDiagnosticStabilityResponseError);
  assert.throws(() => parseOpenClawDiagnosticStability({ ...response, summary: { byType: { 'session.state': 'one' } } }), OpenClawDiagnosticStabilityResponseError);
});

test('OpenClawDiagnosticStabilityClient requests despite discovery omission and maps actual Gateway unavailability', async () => {
  let sent = false;
  const client = new OpenClawDiagnosticStabilityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      sent = true;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });

  await assert.rejects(client.get(), OpenClawDiagnosticStabilityUnavailableError);
  assert.equal(sent, true);
});

test('OpenClawDiagnosticStabilityClient rejects stale and disconnected reads', async () => {
  let current = true;
  const stale = new OpenClawDiagnosticStabilityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return response;
    },
  });
  const disconnected = new OpenClawDiagnosticStabilityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(stale.get(), OpenClawDiagnosticStabilityUnavailableError);
  await assert.rejects(disconnected.get(), OpenClawDiagnosticStabilityUnavailableError);
});
