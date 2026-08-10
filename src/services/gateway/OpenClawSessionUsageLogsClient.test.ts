import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawSessionUsageLogsClient,
  OpenClawSessionUsageLogsResponseError,
  OpenClawSessionUsageLogsUnavailableError,
  parseOpenClawSessionUsageLogs,
} from './OpenClawSessionUsageLogsClient';

const response = {
  logs: [
    { timestamp: 1_754_265_600_000, role: 'user', content: 'Prepare the report', tokens: 12, cost: 0.01 },
    { timestamp: 1_754_265_601_000, role: 'toolResult', content: '[Tool Result]', provider: 'omit' },
  ],
  cursor: 'unknown-additive-field',
};

test('OpenClawSessionUsageLogsClient fences and projects the official logs envelope', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawSessionUsageLogsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });

  const logs = await client.get('  agent:alpha:session-1  ');

  assert.deepEqual(calls, [{
    method: 'sessions.usage.logs',
    params: { key: 'agent:alpha:session-1' },
    connectionId: 'gateway-a',
  }]);
  assert.deepEqual(logs, [
    { timestamp: 1_754_265_600_000, role: 'user', content: 'Prepare the report', tokens: 12 },
    { timestamp: 1_754_265_601_000, role: 'toolResult', content: '[Tool Result]' },
  ]);
  assert.equal('provider' in logs[1], false);
  assert.equal('cost' in logs[0], false);
});

test('OpenClawSessionUsageLogsClient rejects guessed envelopes and malformed known entries', () => {
  assert.throws(() => parseOpenClawSessionUsageLogs(response.logs), OpenClawSessionUsageLogsResponseError);
  assert.throws(() => parseOpenClawSessionUsageLogs({ logs: [{ ...response.logs[0], role: 'system' }] }), OpenClawSessionUsageLogsResponseError);
  assert.throws(() => parseOpenClawSessionUsageLogs({ logs: [{ ...response.logs[0], timestamp: 'now' }] }), OpenClawSessionUsageLogsResponseError);
  assert.throws(() => parseOpenClawSessionUsageLogs({ logs: [{ ...response.logs[0], tokens: -1 }] }), OpenClawSessionUsageLogsResponseError);
});

test('OpenClawSessionUsageLogsClient requests despite discovery omission and maps Gateway unavailability', async () => {
  let sent = false;
  const unavailable = new OpenClawSessionUsageLogsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      sent = true;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  const disconnected = new OpenClawSessionUsageLogsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unavailable.get('agent:alpha:session-1'), OpenClawSessionUsageLogsUnavailableError);
  await assert.rejects(disconnected.get('agent:alpha:session-1'), OpenClawSessionUsageLogsUnavailableError);
  assert.equal(sent, true);
});

test('OpenClawSessionUsageLogsClient rejects a result after the Gateway connection changes', async () => {
  let current = true;
  const client = new OpenClawSessionUsageLogsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return response;
    },
  });

  await assert.rejects(client.get('agent:alpha:session-1'), OpenClawSessionUsageLogsUnavailableError);
});
