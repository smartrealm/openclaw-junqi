import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawHooksStatusClient,
  OpenClawHooksStatusResponseError,
  OpenClawHooksStatusUnavailableError,
  parseOpenClawHooksStatus,
} from './OpenClawHooksStatusClient';

const response = {
  workspaceDir: '/private/workspace',
  managedHooksDir: '/private/hooks',
  hooks: [{
    name: 'session-memory',
    description: 'Retain session context',
    source: 'openclaw-plugin',
    pluginId: 'memory-plugin',
    filePath: '/private/hook.ts',
    baseDir: '/private',
    handlerPath: '/private/hook.ts',
    hookKey: 'session-memory',
    emoji: 'ignored',
    homepage: 'https://example.invalid',
    events: ['command:new'],
    unknownEvents: ['command:typo'],
    always: false,
    enabledByConfig: true,
    requirementsSatisfied: true,
    loadable: true,
    managedByPlugin: true,
    requirements: { bins: ['node'], anyBins: [], env: ['SECRET_NAME'], config: ['hooks.enabled'], os: [] },
    missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
    configChecks: [{ path: 'hooks.enabled', satisfied: true }],
    install: [{ id: 'ignored', kind: 'npm', label: 'ignored', bins: [] }],
  }],
};

test('OpenClawHooksStatusClient fences and strips raw Hook paths and requirement details', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawHooksStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });

  const snapshot = await client.get();

  assert.deepEqual(calls, [{ method: 'hooks.status', params: {}, connectionId: 'gateway-a' }]);
  assert.deepEqual(snapshot, {
    hooks: [{
      name: 'session-memory',
      description: 'Retain session context',
      pluginId: 'memory-plugin',
      events: ['command:new'],
      unknownEvents: ['command:typo'],
      enabledByConfig: true,
      requirementsSatisfied: true,
      loadable: true,
      managedByPlugin: true,
    }],
  });
  assert.equal(JSON.stringify(snapshot).includes('/private'), false);
  assert.equal(JSON.stringify(snapshot).includes('SECRET_NAME'), false);
});

test('OpenClawHooksStatusClient rejects malformed safe Hook fields', () => {
  assert.throws(() => parseOpenClawHooksStatus({ ...response, hooks: [{ ...response.hooks[0], loadable: 'yes' }] }), OpenClawHooksStatusResponseError);
  assert.throws(() => parseOpenClawHooksStatus({ ...response, hooks: [{ ...response.hooks[0], blockedReason: 'not official' }] }), OpenClawHooksStatusResponseError);
});

test('OpenClawHooksStatusClient maps unsupported, disconnected, and stale reads to unavailable', async () => {
  let current = true;
  const unavailable = new OpenClawHooksStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });
  const disconnected = new OpenClawHooksStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });
  const stale = new OpenClawHooksStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return response;
    },
  });

  await assert.rejects(unavailable.get(), OpenClawHooksStatusUnavailableError);
  await assert.rejects(disconnected.get(), OpenClawHooksStatusUnavailableError);
  await assert.rejects(stale.get(), OpenClawHooksStatusUnavailableError);
});
