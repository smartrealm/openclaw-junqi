import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('scheduled tasks uses a filterable master-detail maintenance layout', async () => {
  const source = await read('./CronMonitor.tsx');

  assert.match(source, /statusFilter/);
  assert.match(source, /Master-detail maintenance layout/);
  assert.doesNotMatch(source, /<ClockFace/);
  assert.doesNotMatch(source, /Mission Control/);
  assert.doesNotMatch(source, /🚀|⏰|⏱️|⚡|🔄|👈/u);
});

test('channels prioritizes configured instances and shows diagnostics on demand', async () => {
  const source = await read('./ChannelsCenter/index.tsx');

  assert.match(source, /\(!gatewayHealthy \|\| diagnosticsOpen\)/);
  assert.match(source, /id="available-channels"/);
  assert.match(source, /readinessFilter/);
  assert.doesNotMatch(source, /lg:grid-cols-5/);
  assert.doesNotMatch(source, /bg-gradient-to-br/);
});
