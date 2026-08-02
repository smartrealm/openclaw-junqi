import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

interface RuntimeConfigSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues?: unknown[] } };
}

test('pinned OpenClaw schema rejects the unsupported modelPolicy field', async () => {
  const pluginRequire = createRequire(
    new URL('../../../packages/junqi-collab/package.json', import.meta.url),
  );
  const dist = pathToFileURL(`${dirname(pluginRequire.resolve('openclaw'))}${sep}`);
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
