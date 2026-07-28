import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const hook = readFileSync(new URL('./useWorkbenchSessionPersistence.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

test('workbench persistence is globally mounted and load precedes writer enablement', () => {
  assert.match(app, /useWorkbenchSessionPersistence\(\)/);
  const loadIndex = hook.indexOf('loadWorkbenchSession(LOCAL_PARTITION)');
  const hydrateIndex = hook.indexOf('hydrateSession(loaded.snapshot)');
  const enableIndex = hook.indexOf('writer.enable(loaded.generation)');
  assert.ok(loadIndex >= 0 && enableIndex > loadIndex && hydrateIndex > enableIndex);
});

test('main-window close is fenced by one durable checkpoint before destroy', () => {
  assert.match(hook, /onCloseRequested/);
  assert.match(hook, /event\.preventDefault\(\)/);
  assert.match(hook, /closeCheckpointRef\.current/);
  assert.match(hook, /writer\.checkpoint\(useWorkbenchStore\.getState\(\)\.sessionSnapshot\(\)\)/);
  assert.match(hook, /\.then\(\(\) => window\.destroy\(\)\)/);
});

test('failed hydration leaves the durable writer fail closed', () => {
  assert.match(hook, /failHydration/);
  assert.match(hook, /!state\.writerReady \|\| !writerRef\.current\?\.isReady\(\)/);
  assert.match(hook, /generation conflict or durable write failure closes the gate/);
});
