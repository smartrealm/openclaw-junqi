import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawAgentsWorkspaceClient,
  OpenClawAgentsWorkspaceResponseError,
  OpenClawAgentsWorkspaceUnavailableError,
} from './OpenClawAgentsWorkspaceClient';

const listResponse = {
  agentId: 'research',
  path: '',
  entries: [{ path: 'notes', name: 'notes', kind: 'directory', updatedAtMs: 12 }],
  totalEntries: 1,
  offset: 0,
};

const fileResponse = {
  agentId: 'research',
  file: {
    path: 'notes/brief.txt',
    name: 'brief.txt',
    size: 5,
    updatedAtMs: 12,
    mimeType: 'text/plain',
    encoding: 'utf8',
    content: 'brief',
  },
};

test('agents workspace client sends only the official relative-path requests', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return method === 'agents.workspace.list' ? listResponse : fileResponse;
    },
  });

  const listing = await client.list({ agentId: ' research ' });
  const file = await client.get('research', 'notes/brief.txt');

  assert.deepEqual(calls, [
    { method: 'agents.workspace.list', params: { agentId: 'research' }, connectionId: 'gateway-a' },
    { method: 'agents.workspace.get', params: { agentId: 'research', path: 'notes/brief.txt' }, connectionId: 'gateway-a' },
  ]);
  assert.equal(listing.entries[0]?.path, 'notes');
  assert.equal(file.content, 'brief');
});

test('agents workspace client rejects path escapes and malformed Gateway results', async () => {
  const client = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => listResponse,
  });

  await assert.rejects(client.get('research', '../secret.txt'), OpenClawAgentsWorkspaceResponseError);
  await assert.rejects(client.list({ agentId: 'research', path: '/host/path' }), OpenClawAgentsWorkspaceResponseError);
  await assert.rejects(client.list({ agentId: 'research', limit: 0 }), OpenClawAgentsWorkspaceResponseError);

  const malformed = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({ ...listResponse, agentId: 'other' }),
  });
  await assert.rejects(malformed.list({ agentId: 'research' }), OpenClawAgentsWorkspaceResponseError);
});

test('agents workspace client accepts only supported base64 images', async () => {
  const image = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({
      agentId: 'research',
      file: { ...fileResponse.file, mimeType: 'image/png', encoding: 'base64', content: 'aW1hZ2U=' },
    }),
  });
  const unsupported = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({
      agentId: 'research',
      file: { ...fileResponse.file, mimeType: 'image/svg+xml', encoding: 'base64', content: 'aW1hZ2U=' },
    }),
  });

  assert.equal((await image.get('research', 'notes/brief.txt')).encoding, 'base64');
  await assert.rejects(unsupported.get('research', 'notes/brief.txt'), OpenClawAgentsWorkspaceResponseError);
});

test('agents workspace client sends requests without a method advertisement and fences stale results', async () => {
  let sent = false;
  const unavailable = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      sent = true;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  let current = true;
  const stale = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return listResponse;
    },
  });
  const disconnected = new OpenClawAgentsWorkspaceClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unavailable.list({ agentId: 'research' }), OpenClawAgentsWorkspaceUnavailableError);
  assert.equal(sent, true);
  await assert.rejects(stale.list({ agentId: 'research' }), OpenClawAgentsWorkspaceUnavailableError);
  await assert.rejects(disconnected.list({ agentId: 'research' }), OpenClawAgentsWorkspaceUnavailableError);
});
