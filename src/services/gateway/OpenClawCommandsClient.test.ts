import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawCommandsClient,
  OpenClawCommandsResponseError,
  OpenClawCommandsUnavailableError,
  parseOpenClawCommandsList,
} from './OpenClawCommandsClient';

const weatherArgument = {
  name: 'unit',
  description: 'Display unit.',
  type: 'string',
  choices: [
    { value: 'metric', label: 'Metric' },
    { value: 'imperial', label: 'Imperial' },
  ],
};

const response = {
  commands: [{
    name: 'status',
    nativeName: 'status',
    textAliases: ['/status'],
    description: 'Show the current status.',
    category: 'status',
    source: 'native',
    scope: 'both',
    acceptsArgs: false,
  }, {
    name: 'weather',
    textAliases: ['/weather'],
    description: 'Get the weather.',
    category: 'tools',
    source: 'skill',
    skillModelVisible: true,
    scope: 'text',
    acceptsArgs: true,
    args: [weatherArgument],
  }],
};

test('OpenClawCommandsClient fences the official agent-scoped text command request', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawCommandsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    hasAdvertisedMethod: () => true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });

  assert.deepEqual(await client.list({
    agentId: ' main ',
    provider: ' discord ',
    scope: 'text',
    includeArgs: true,
  }), response.commands);
  assert.deepEqual(calls, [{
    method: 'commands.list',
    params: { agentId: 'main', provider: 'discord', scope: 'text', includeArgs: true },
    connectionId: 'gateway-a',
  }]);
});

test('command catalog parsing rejects invalid protocol enums and shapes without supplying fallback entries', () => {
  assert.throws(() => parseOpenClawCommandsList({
    commands: [{ ...response.commands[0], source: 'extension' }],
  }), OpenClawCommandsResponseError);
  assert.throws(() => parseOpenClawCommandsList({
    commands: [{ ...response.commands[1], args: [{ ...weatherArgument, type: 'object' }] }],
  }), OpenClawCommandsResponseError);
  assert.throws(() => parseOpenClawCommandsList({
    commands: [{ ...response.commands[0], textAliases: [''] }],
  }), OpenClawCommandsResponseError);
  assert.throws(() => parseOpenClawCommandsList({ commands: 'status' }), OpenClawCommandsResponseError);
});

test('commands.list is never sent when the Gateway does not advertise it and missing responses remain unavailable', async () => {
  const unavailable = new OpenClawCommandsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => false,
    requestFenced: async () => { throw new Error('request must not be sent'); },
  });
  const missing = new OpenClawCommandsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => null,
    requestFenced: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });

  await assert.rejects(unavailable.list(), OpenClawCommandsUnavailableError);
  await assert.rejects(missing.list(), OpenClawCommandsUnavailableError);
});

test('commands.list discards a response after connection identity changes or disconnects', async () => {
  let current = true;
  const stale = new OpenClawCommandsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => {
      current = false;
      return response;
    },
  });
  const disconnected = new OpenClawCommandsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(stale.list(), OpenClawCommandsUnavailableError);
  await assert.rejects(disconnected.list(), OpenClawCommandsUnavailableError);
});
