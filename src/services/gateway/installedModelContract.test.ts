import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

interface RuntimeConfigSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues?: unknown[] } };
}

test('pinned OpenClaw schema rejects the unsupported modelPolicy field', async () => {
  const dist = new URL('../../../node_modules/.pnpm/openclaw@2026.7.1/node_modules/openclaw/dist/', import.meta.url);
  const schemaFile = readdirSync(dist).find((name) => /^zod-schema-[^.].*\.js$/.test(name));
  assert.ok(schemaFile, 'the pinned OpenClaw config schema bundle must exist');

  const module = await import(new URL(schemaFile, dist).href) as { t?: RuntimeConfigSchema };
  assert.ok(module.t?.safeParse, 'the pinned OpenClaw config schema must be exported');
  const result = module.t.safeParse({
    agents: { defaults: { modelPolicy: { allow: ['openai/*'] } } },
  });

  assert.equal(result.success, false);
  assert.ok(result.error?.issues?.length);
});
