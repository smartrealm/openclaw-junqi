import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawAgentFilesClient,
  OpenClawAgentFilesResponseError,
  OpenClawAgentFilesUnavailableError,
} from './OpenClawAgentFilesClient';

const listResponse = {
  agentId: 'research',
  workspace: '/private/agent-workspace',
  files: [{
    name: 'AGENTS.md',
    path: '/private/agent-workspace/AGENTS.md',
    missing: false,
    size: 12,
    updatedAtMs: 34,
  }],
};

const getResponse = {
  agentId: 'research',
  workspace: '/private/agent-workspace',
  file: {
    ...listResponse.files[0],
    content: 'instructions',
  },
};

test('agent files client sends official requests and discards Gateway host paths', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return method === 'agents.files.list' ? listResponse : getResponse;
    },
  });

  const listing = await client.list(' research ');
  const file = await client.get('research', 'AGENTS.md');

  assert.deepEqual(calls, [
    { method: 'agents.files.list', params: { agentId: 'research' }, connectionId: 'gateway-a' },
    { method: 'agents.files.get', params: { agentId: 'research', name: 'AGENTS.md' }, connectionId: 'gateway-a' },
  ]);
  assert.deepEqual(listing.files[0], { name: 'AGENTS.md', missing: false, size: 12, updatedAtMs: 34 });
  assert.deepEqual(file.file, { name: 'AGENTS.md', missing: false, size: 12, updatedAtMs: 34, content: 'instructions' });
  assert.equal('workspace' in listing, false);
  assert.equal('path' in file.file, false);
});

test('agent files client rejects unsafe names and mismatched responses', async () => {
  const client = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => getResponse,
  });
  await assert.rejects(client.get('research', '../AGENTS.md'), OpenClawAgentFilesResponseError);

  const malformed = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({ ...listResponse, agentId: 'other' }),
  });
  await assert.rejects(malformed.list('research'), OpenClawAgentFilesResponseError);
});

test('agent files client preserves expected absence without creating local content', async () => {
  const client = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({
      agentId: 'research',
      workspace: '/private/agent-workspace',
      file: { name: 'MEMORY.md', path: '/private/agent-workspace/MEMORY.md', missing: true, expectedAbsent: true },
    }),
  });
  const result = await client.get('research', 'MEMORY.md');
  assert.deepEqual(result.file, { name: 'MEMORY.md', missing: true, expectedAbsent: true });
});

test('agent files client requests without an advertisement and fences stale reads', async () => {
  let sent = false;
  const unavailable = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      sent = true;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  let current = true;
  const stale = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return listResponse;
    },
  });
  const disconnected = new OpenClawAgentFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unavailable.list('research'), OpenClawAgentFilesUnavailableError);
  assert.equal(sent, true);
  await assert.rejects(stale.list('research'), OpenClawAgentFilesUnavailableError);
  await assert.rejects(disconnected.list('research'), OpenClawAgentFilesUnavailableError);
});
