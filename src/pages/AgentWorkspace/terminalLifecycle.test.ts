import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('terminal tabs physically stop their exact run before UI removal', () => {
  const close = source.slice(source.indexOf('const closeTab = async'), source.indexOf('const closeGroup = async'));
  assert.ok(close.indexOf('await closeWorkbenchPtyTab') < close.indexOf('closeStoreTab'));
  assert.match(close, /ptyId: tab\.ptyId, runId: tab\.ptyRunId/);
});

test('group close uses atomic ownership validation and preserves UI on failure', () => {
  const close = source.slice(source.indexOf('const closeGroup = async'), source.indexOf('const openFile'));
  assert.ok(close.indexOf('await closeWorkbenchPtyTabs') < close.indexOf('removeStoreGroup'));
  assert.match(close, /catch \(reason\)/);
  assert.doesNotMatch(close.slice(close.indexOf('catch')), /removeStoreGroup/);
});
