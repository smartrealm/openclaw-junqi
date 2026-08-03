import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_TOOLS_INVOKE_METHOD,
  OpenClawToolsInvokeClient,
  OpenClawToolsInvokeResponseError,
  parseOpenClawToolsInvokeResult,
} from './OpenClawToolsInvokeClient';

describe('OpenClawToolsInvokeClient', () => {
  it('sends only the official tools.invoke fields', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawToolsInvokeClient(async <T>(method: string, params: Record<string, unknown>) => {
      requests.push({ method, params });
      return {
        ok: true,
        toolName: 'memory_search',
        output: { results: [] },
        source: 'plugin',
        ignoredByClient: 'forward-compatible',
      } as T;
    });

    const result = await client.invoke({
      name: ' memory_search ',
      args: { query: 'JunQi' },
      sessionKey: ' agent:main:main ',
      agentId: ' main ',
      confirm: true,
      idempotencyKey: ' invoke-1 ',
    });

    assert.deepEqual(requests, [{
      method: OPENCLAW_TOOLS_INVOKE_METHOD,
      params: {
        name: 'memory_search',
        args: { query: 'JunQi' },
        sessionKey: 'agent:main:main',
        agentId: 'main',
        confirm: true,
        idempotencyKey: 'invoke-1',
      },
    }]);
    assert.deepEqual(result, {
      ok: true,
      toolName: 'memory_search',
      output: { results: [] },
      source: 'plugin',
    });
  });

  it('preserves official failed results and approval metadata', () => {
    assert.deepEqual(parseOpenClawToolsInvokeResult({
      ok: false,
      toolName: 'exec',
      requiresApproval: true,
      approvalId: 'approval-1',
      error: {
        code: 'requires_approval',
        message: 'Approval required',
        details: { source: 'gateway' },
      },
    }), {
      ok: false,
      toolName: 'exec',
      requiresApproval: true,
      approvalId: 'approval-1',
      error: {
        code: 'requires_approval',
        message: 'Approval required',
        details: { source: 'gateway' },
      },
    });
  });

  it('rejects malformed results instead of synthesizing a status', () => {
    for (const value of [
      {},
      { ok: true },
      { ok: 'true', toolName: 'exec' },
      { ok: false, toolName: 'exec', error: { code: 'blocked' } },
      { ok: false, toolName: 'exec', approvalId: '' },
    ]) {
      assert.throws(() => parseOpenClawToolsInvokeResult(value), OpenClawToolsInvokeResponseError);
    }
  });

  it('validates request values before transport', async () => {
    const client = new OpenClawToolsInvokeClient(async <T>() => ({ ok: true, toolName: 'exec' }) as T);
    await assert.rejects(
      client.invoke({ name: 'exec', args: [] as unknown as Record<string, unknown> }),
      /tools\.invoke/,
    );
    await assert.rejects(
      client.invoke({ name: 'exec', confirm: 'yes' as unknown as boolean }),
      /tools\.invoke confirm/,
    );
  });
});
