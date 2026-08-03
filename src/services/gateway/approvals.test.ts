import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawApprovalClient,
  buildApprovalResolveParams,
  parseApprovalList,
  parseApprovalResolveResult,
  parseGatewayApprovalEvent,
} from './approvals';

const base = { createdAtMs: 100, expiresAtMs: 10_000 };

test('approval list parsing keeps command metadata bounded and preserves Gateway decisions', () => {
  const [record] = parseApprovalList([{
    id: 'exec-1',
    ...base,
    request: {
      command: 'git status',
      commandPreview: 'git status',
      host: 'gateway',
      allowedDecisions: ['allow-once', 'deny'],
      envKeys: ['TOKEN'],
    },
  }], 'exec');

  assert.equal(record.kind, 'exec');
  assert.deepEqual(record.request.allowedDecisions, ['allow-once', 'deny']);
  assert.equal(record.request.command, 'git status');
  assert.equal('env' in record.request, false);
  assert.equal('envKeys' in record.request, false);
});

test('plugin approval parsing applies only the documented omitted-decision default', () => {
  const [record] = parseApprovalList([{
    id: 'plugin:1',
    ...base,
    request: {
      title: 'Publish result',
      description: 'Send the generated result to the configured destination.',
      severity: 'warning',
      pluginId: 'publisher',
    },
  }], 'plugin');

  assert.equal(record.kind, 'plugin');
  assert.deepEqual(record.request.allowedDecisions, ['allow-once', 'allow-always', 'deny']);
  assert.equal(record.request.pluginId, 'publisher');
});

test('approval parsing fails closed on unknown decision or missing required fields', () => {
  assert.throws(() => parseApprovalList([{
    id: 'exec-1',
    ...base,
    request: { command: 'whoami', allowedDecisions: ['approve'] },
  }], 'exec'), /allowedDecisions/);
  assert.throws(() => parseApprovalList([{
    id: 'plugin:1',
    ...base,
    request: { title: 'Only title' },
  }], 'plugin'), /description/);
});

test('approval event parsing preserves requested and resolved identities', () => {
  const requested = parseGatewayApprovalEvent({
    type: 'event',
    event: 'plugin.approval.requested',
    payload: {
      id: 'plugin:2',
      ...base,
      request: { title: 'Review', description: 'Review this action.', allowedDecisions: ['deny'] },
    },
  });
  assert.equal(requested?.phase, 'requested');
  if (requested?.phase === 'requested') assert.equal(requested.record.id, 'plugin:2');

  const resolved = parseGatewayApprovalEvent({
    type: 'event',
    event: 'exec.approval.resolved',
    payload: { id: 'exec-2', decision: 'deny', resolvedBy: 'operator-device', ts: 123 },
  });
  assert.deepEqual(resolved, {
    phase: 'resolved',
    kind: 'exec',
    id: 'exec-2',
    decision: 'deny',
    resolvedBy: 'operator-device',
    ts: 123,
  });
});

test('approval client uses the approvals lane for list and resolve', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawApprovalClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      if (method === 'exec.approval.list') return [{
        id: 'exec-1',
        ...base,
        request: { command: 'pwd', allowedDecisions: ['allow-once', 'deny'] },
      }];
      if (method === 'plugin.approval.list') return [];
      return { ok: true };
    },
  });

  const approvals = await client.list();
  assert.equal(approvals.length, 1);
  await client.resolve(approvals[0], 'deny');
  assert.deepEqual(calls, [
    { method: 'exec.approval.list', params: {} },
    { method: 'plugin.approval.list', params: {} },
    { method: 'exec.approval.resolve', params: { id: 'exec-1', decision: 'deny' } },
  ]);
  assert.deepEqual(buildApprovalResolveParams(' exec-1 ', 'allow-once'), {
    id: 'exec-1',
    decision: 'allow-once',
  });
  assert.deepEqual(parseApprovalResolveResult({ ok: true }), { ok: true });
  assert.throws(() => parseApprovalResolveResult({ ok: false }), /not confirmed/);
});
