import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawPlanToolSettingsClient,
  resolveOpenClawPlanToolMode,
} from './OpenClawPlanToolSettings';

test('resolves automatic and explicit plan tool modes from config', () => {
  assert.equal(resolveOpenClawPlanToolMode({}), 'automatic');
  assert.equal(resolveOpenClawPlanToolMode({ tools: { experimental: { planTool: true } } }), 'enabled');
  assert.equal(resolveOpenClawPlanToolMode({ tools: { experimental: { planTool: false } } }), 'disabled');
});

test('writes a guarded patch while preserving sibling experimental flags', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawPlanToolSettingsClient({
    async call() {
      return {
        exists: true,
        valid: true,
        config: { tools: { experimental: { otherPreview: true } } },
        hash: 'config-hash',
      };
    },
    async callPrivileged(method, params) {
      calls.push({ method, params });
      return { ok: true };
    },
  });

  await client.write('enabled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'config.patch');
  assert.equal(calls[0].params.baseHash, 'config-hash');
  assert.deepEqual(calls[0].params.replacePaths, ['tools.experimental']);
  assert.deepEqual(JSON.parse(String(calls[0].params.raw)), {
    tools: { experimental: { otherPreview: true, planTool: true } },
  });
});

test('automatic mode removes only the plan tool override', async () => {
  const patches: Record<string, unknown>[] = [];
  const client = new OpenClawPlanToolSettingsClient({
    async call() {
      return {
        exists: true,
        valid: true,
        config: { tools: { experimental: { planTool: false, otherPreview: true } } },
        hash: 'config-hash',
      };
    },
    async callPrivileged(_method, params) {
      patches.push(params);
      return { ok: true };
    },
  });

  await client.write('automatic');
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(String(patches[0].raw)), {
    tools: { experimental: { otherPreview: true } },
  });
});

test('allows the official hashless first-write configuration flow', async () => {
  const patches: Record<string, unknown>[] = [];
  const client = new OpenClawPlanToolSettingsClient({
    async call() {
      return {
        exists: false,
        valid: true,
        config: {},
      };
    },
    async callPrivileged(_method, params) {
      patches.push(params);
      return { ok: true };
    },
  });

  await client.write('enabled');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].baseHash, undefined);
  assert.deepEqual(JSON.parse(String(patches[0].raw)), {
    tools: { experimental: { planTool: true } },
  });
});

test('does not report a plan tool write when the official acknowledgement is negative', async () => {
  const client = new OpenClawPlanToolSettingsClient({
    async call() {
      return { exists: true, valid: true, config: {}, hash: 'config-hash' };
    },
    async callPrivileged() {
      return { ok: false };
    },
  });

  await assert.rejects(() => client.write('enabled'), /config\.patch response is unavailable/);
});
