import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolsInvokeParams, parseToolsInvokeResult } from './toolsInvoke';

test('builds the official tools.invoke envelope and normalizes identities', () => {
  assert.deepEqual(buildToolsInvokeParams({
    name: ' browser.open ',
    args: { url: 'https://example.test' },
    sessionKey: ' agent:main:main ',
    agentId: ' main ',
    confirm: true,
    idempotencyKey: ' invoke-1 ',
  }), {
    name: 'browser.open',
    args: { url: 'https://example.test' },
    sessionKey: 'agent:main:main',
    agentId: 'main',
    confirm: true,
    idempotencyKey: 'invoke-1',
  });
  assert.deepEqual(buildToolsInvokeParams({ name: 'health' }), { name: 'health' });
});

test('rejects empty identities and non-object arguments', () => {
  assert.throws(() => buildToolsInvokeParams({ name: ' ' }), /tool name/);
  assert.throws(() => buildToolsInvokeParams({ name: 'health', sessionKey: ' ' }), /session key/);
  assert.throws(() => buildToolsInvokeParams({ name: 'health', args: [] as unknown as Record<string, unknown> }), /JSON object/);
});

test('preserves successful output and optional source metadata', () => {
  assert.deepEqual(parseToolsInvokeResult({
    ok: true,
    toolName: 'browser.open',
    source: 'mcp',
    output: { title: 'Example' },
  }), {
    ok: true,
    toolName: 'browser.open',
    source: 'mcp',
    output: { title: 'Example' },
  });
});

test('preserves approval and structured error results without treating them as success', () => {
  assert.deepEqual(parseToolsInvokeResult({
    ok: false,
    toolName: 'gateway.restart',
    requiresApproval: true,
    approvalId: 'approval-1',
    error: { code: 'requires_approval', message: 'Approval required', details: { scope: 'admin' } },
  }), {
    ok: false,
    toolName: 'gateway.restart',
    requiresApproval: true,
    approvalId: 'approval-1',
    error: { code: 'requires_approval', message: 'Approval required', details: { scope: 'admin' } },
  });
  assert.throws(() => parseToolsInvokeResult({ ok: true, toolName: ' ' }), /tool name/);
  assert.throws(() => parseToolsInvokeResult({ ok: false, toolName: 'health', approvalId: ' ' }), /approvalId/);
  assert.throws(() => parseToolsInvokeResult({ ok: false, toolName: 'health', error: { code: 'x' } }), /error message/);
});
