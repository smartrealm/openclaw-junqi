import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawApprovalClient,
  OpenClawApprovalResponseError,
  OPENCLAW_APPROVAL_RESOLVE_METHOD,
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
    (method) => method !== OPENCLAW_APPROVAL_RESOLVE_METHOD,
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
    (method) => method !== OPENCLAW_APPROVAL_RESOLVE_METHOD,
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

test('uses the unified approval resolver when the Gateway advertises it', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawApprovalClient(
    async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      calls.push({ method, params });
      return {
        applied: true,
        approval: {
          id: 'exec-1',
          urlPath: '/approve/exec-1',
          createdAtMs: 100,
          expiresAtMs: 200,
          resolvedAtMs: 150,
          status: 'allowed',
          reason: 'user',
          decision: 'allow-once',
          presentation: {
            kind: 'exec',
            commandText: 'git status --short',
            allowedDecisions: ['allow-once', 'deny'],
          },
        },
      } as T;
    },
    (method) => method === OPENCLAW_APPROVAL_RESOLVE_METHOD,
  );

  const result = await client.resolve({ kind: 'exec', ...execApproval }, 'allow-once');
  assert.equal(result?.applied, true);
  assert.equal(result?.approval.status, 'allowed');
  assert.deepEqual(calls, [{
    method: OPENCLAW_APPROVAL_RESOLVE_METHOD,
    params: { id: 'exec-1', kind: 'exec', decision: 'allow-once' },
  }]);
});

test('falls back to the legacy resolver when unified method discovery is stale', async () => {
  const calls: string[] = [];
  const client = new OpenClawApprovalClient(
    async <T>(method: string): Promise<T> => {
      calls.push(method);
      if (method === OPENCLAW_APPROVAL_RESOLVE_METHOD) {
        throw new GatewayRpcError('method not found', 'METHOD_NOT_FOUND');
      }
      return { ok: true } as T;
    },
    () => true,
  );

  await client.resolve({ kind: 'plugin', ...pluginApproval }, 'deny');
  assert.deepEqual(calls, [OPENCLAW_APPROVAL_RESOLVE_METHOD, 'plugin.approval.resolve']);
});

test('parses the official approval history snapshots without exposing runtime details', async () => {
  const client = new OpenClawApprovalClient(
    async <T>(): Promise<T> => ({
      items: [{
        id: 'system-1',
        urlPath: '/approve/system-1',
        createdAtMs: 100,
        expiresAtMs: 200,
        resolvedAtMs: 150,
        status: 'denied',
        reason: 'user',
        decision: 'deny',
        source: { agentId: 'main', sessionKey: 'agent:main:main' },
        resolver: { kind: 'device', id: 'device-1' },
        presentation: {
          kind: 'system-agent',
          title: 'Update gateway',
          description: 'Apply a reviewed gateway change.',
          proposalHash: 'a'.repeat(64),
          allowedDecisions: ['allow-once', 'deny'],
          cwd: '/must-not-be-accepted',
        },
      }],
      nextCursor: 'next-page',
    }) as T,
    (method) => method === 'approval.history',
  );

  const result = await client.history({ kind: 'system-agent', limit: 25 });
  assert.equal(result.availability, 'available');
  assert.equal(result.items[0]?.presentation.kind, 'system-agent');
  assert.equal(result.items[0]?.resolver?.kind, 'device');
  assert.equal(result.nextCursor, 'next-page');
  assert.equal('cwd' in (result.items[0]?.presentation ?? {}), false);
});

test('rejects malformed unified approval history responses', async () => {
  const client = new OpenClawApprovalClient(
    async <T>(): Promise<T> => ({ items: [{ status: 'pending' }] } as T),
    (method) => method === 'approval.history',
  );
  await assert.rejects(client.history(), OpenClawApprovalResponseError);
});

test('gets one official approval snapshot when the Gateway advertises approval.get', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawApprovalClient(
    async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      calls.push({ method, params });
      return {
        approval: {
          id: 'plugin-1',
          urlPath: '/approve/plugin-1',
          createdAtMs: 100,
          expiresAtMs: 200,
          status: 'pending',
          presentation: {
            kind: 'plugin',
            title: 'Calendar access',
            description: 'Read calendar events.',
            severity: 'info',
            allowedDecisions: ['allow-once', 'deny'],
          },
        },
      } as T;
    },
    (method) => method === 'approval.get',
  );

  const result = await client.get('plugin-1');
  assert.equal(result.availability, 'available');
  assert.equal(result.approval?.status, 'pending');
  assert.deepEqual(calls, [{ method: 'approval.get', params: { id: 'plugin-1' } }]);
});

test('validates unified approval ids with the official path-safe contract', async () => {
  const client = new OpenClawApprovalClient(
    async <T>(): Promise<T> => {
      throw new Error('request should not run for invalid ids');
    },
    () => false,
  );
  await assert.rejects(client.get(''), OpenClawApprovalResponseError);
  await assert.rejects(client.get('.'), OpenClawApprovalResponseError);
  await assert.rejects(client.get('..'), OpenClawApprovalResponseError);
  await assert.rejects(client.get('\ud800'), OpenClawApprovalResponseError);
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
