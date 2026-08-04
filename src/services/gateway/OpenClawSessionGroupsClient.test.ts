import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawSessionGroupsClient,
  OpenClawSessionGroupsResponseError,
  OpenClawSessionGroupsUnsupportedError,
} from './OpenClawSessionGroupsClient';

test('reads the official session group catalog in Gateway display order', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionGroupsClient(async (method, params) => {
    calls.push({ method, params });
    return {
      groups: [
        { name: 'Later', position: 2 },
        { name: 'First', position: 0 },
        { name: 'Middle', position: 1 },
      ],
    } as never;
  });

  assert.deepEqual(await client.list(), [
    { name: 'First', position: 0 },
    { name: 'Middle', position: 1 },
    { name: 'Later', position: 2 },
  ]);
  assert.deepEqual(calls, [{ method: 'sessions.groups.list', params: {} }]);
});

test('does not treat an omitted method advertisement as a capability gate', async () => {
  let requests = 0;
  const client = new OpenClawSessionGroupsClient(async () => {
    requests += 1;
    return { groups: [] } as never;
  });

  assert.deepEqual(await client.list(), []);
  assert.equal(requests, 1);
});

test('maps only explicit unsupported responses and rejects malformed catalogs', async () => {
  const unsupported = new OpenClawSessionGroupsClient(async () => {
    throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND');
  });
  const malformed = new OpenClawSessionGroupsClient(async () => ({
    groups: [{ name: 'Missing position' }],
  }) as never);
  const denied = new OpenClawSessionGroupsClient(async () => {
    throw new GatewayRpcError('operator.read required', 'UNAUTHORIZED');
  });

  await assert.rejects(unsupported.list(), OpenClawSessionGroupsUnsupportedError);
  await assert.rejects(malformed.list(), OpenClawSessionGroupsResponseError);
  await assert.rejects(denied.list(), GatewayRpcError);
});
