import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./localWatchCoordinator.ts', import.meta.url), 'utf8');
const explorer = readFileSync(new URL('../../components/FileExplorer/FileExplorer.tsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../../components/FileExplorer/FileViewer.tsx', import.meta.url), 'utf8');

test('legacy native watch events are represented as overflow, not invented precision', () => {
  assert.match(source, /kind: 'overflow'/);
  assert.match(source, /registration\.path !== event\.payload\.dir/);
  assert.doesNotMatch(source, /kind: 'changed'/);
});

test('legacy transport registers event ownership before native start and rolls back exact failures', () => {
  assert.ok(source.indexOf('registrations.set(watchId, registration)') < source.indexOf("invoke<boolean>('watch_dir'"));
  assert.match(source, /registrations\.get\(watchId\) === registration/);
});

test('FileExplorer and FileViewer no longer own native watcher IPC', () => {
  for (const consumer of [explorer, viewer]) {
    assert.match(consumer, /subscribeLocalWorkspacePath/);
    assert.doesNotMatch(consumer, /"watch_dir"|"unwatch_dir"|"fs-changed"/);
  }
});
