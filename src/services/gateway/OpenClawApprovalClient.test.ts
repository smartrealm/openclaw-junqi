import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawApprovalClient,
  OpenClawApprovalResponseError,
} from './OpenClawApprovalClient';

const execApproval = {
  id: 'exec-1',
  request: {
    command: 'git status --short',
    commandPreview: 'git status --short',
    commandArgv: ['git', 'status', '--short'],
    allowedDecisions: ['allow-once', 'deny'],
    cwd: '/workspace',
    host: 'gateway',
    agentId: 'main',
    sessionKey: 'agent:main:main',
  },
  createdAtMs: 100,
  expiresAtMs: 200,
} as const;

const pluginApproval = {
  id: 'plugin-1',
  request: {
    pluginId: 'calendar',
    title: 'Calendar access',
    description: 'The calendar plugin needs permission to read events.',
    severity: 'warning',
    toolName: 'calendar.list',
    allowedDecisions: ['allow-once', 'allow-always', 'deny'],
  },
  createdAtMs: 101,
  expiresAtMs: 201,
} as const;

test('lists native exec and plugin approvals with strict typed fields', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawApprovalClient(
    async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      calls.push({ method, params });
      return (method === 'exec.approval.list' ? [execApproval] : [pluginApproval]) as T;
    },
    () => null,
  );

  const result = await client.list();
  assert.equal(result.approvals.length, 2);
  assert.equal(result.approvals[0]?.kind, 'exec');
  assert.equal(result.approvals[1]?.kind, 'plugin');
  assert.deepEqual(result.availability, { exec: 'available', plugin: 'available' });
  assert.deepEqual(calls, [
    { method: 'exec.approval.list', params: {} },
    { method: 'plugin.approval.list', params: {} },
  ]);
});

test('accepts the current OpenClaw plugin description limit', async () => {
  const client = new OpenClawApprovalClient(
    async <T>(method: string): Promise<T> => (
      method === 'plugin.approval.list'
        ? [{
          ...pluginApproval,
          request: {
            ...pluginApproval.request,
            description: 'x'.repeat(512),
          },
        }]
        : []
    ) as T,
    () => true,
  );

  const result = await client.list();
  assert.equal(result.approvals[0]?.kind, 'plugin');
});

test('does not call a family explicitly absent from hello-ok methods', async () => {
  const calls: string[] = [];
  const client = new OpenClawApprovalClient(
    async <T>(method: string): Promise<T> => {
      calls.push(method);
      return [execApproval] as T;
    },
    (method) => method === 'exec.approval.list',
  );

  const result = await client.list();
  assert.deepEqual(result.availability, { exec: 'available', plugin: 'unavailable' });
  assert.deepEqual(calls, ['exec.approval.list']);
});

test('treats an authoritative method-not-found response as unavailable', async () => {
  const client = new OpenClawApprovalClient(
    async <T>(method: string): Promise<T> => {
      if (method === 'exec.approval.list') {
        throw new GatewayRpcError('method not found', 'METHOD_NOT_FOUND');
      }
      return [pluginApproval] as T;
    },
    () => null,
  );

  const result = await client.list();
  assert.deepEqual(result.availability, { exec: 'unavailable', plugin: 'available' });
});

test('resolves only a Gateway-advertised decision and confirms native success', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawApprovalClient(
    async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      calls.push({ method, params });
      return { ok: true } as T;
    },
    () => true,
  );

  await client.resolve({
    kind: 'exec',
    ...execApproval,
    request: {
      ...execApproval.request,
      allowedDecisions: ['allow-once', 'deny'],
    },
  }, 'deny');
  assert.deepEqual(calls, [{
    method: 'exec.approval.resolve',
    params: { id: 'exec-1', decision: 'deny' },
  }]);
  await assert.rejects(
    client.resolve({
      kind: 'exec',
      ...execApproval,
      request: { ...execApproval.request, allowedDecisions: ['deny'] },
    }, 'allow-once'),
  );
});

test('rejects malformed list and unresolved native responses without claiming success', async () => {
  const malformed = new OpenClawApprovalClient(
    async <T>(): Promise<T> => ({ bad: true } as T),
    () => true,
  );
  await assert.rejects(malformed.list(), OpenClawApprovalResponseError);

  const emptyDecisionSet = new OpenClawApprovalClient(
    async <T>(): Promise<T> => [{
      ...execApproval,
      request: { ...execApproval.request, allowedDecisions: [] },
    }] as T,
    () => true,
  );
  await assert.rejects(emptyDecisionSet.list(), OpenClawApprovalResponseError);

  const invalidResolve = new OpenClawApprovalClient(
    async <T>(): Promise<T> => ({ ok: false } as T),
    () => true,
  );
  await assert.rejects(
    invalidResolve.resolve({ kind: 'plugin', ...pluginApproval }, 'deny'),
    OpenClawApprovalResponseError,
  );
});

test('keeps transport or authorization errors distinct from unsupported method handling', async () => {
  const error = new GatewayRpcError('approval scope required', 'UNAUTHORIZED');
  const client = new OpenClawApprovalClient(
    async <T>(): Promise<T> => { throw error; },
    () => null,
  );
  await assert.rejects(client.list(), (received: unknown) => received === error);
});
