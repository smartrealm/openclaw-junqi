import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./WorkbenchTerminalPane.tsx', import.meta.url), 'utf8');

test('workbench terminal subscribes before create and restores an existing run snapshot', () => {
  const subscribe = source.indexOf('await subscribeWorkbenchPty(');
  const create = source.indexOf('await createWorkbenchPty(');
  assert.ok(subscribe >= 0 && create > subscribe);
  assert.match(source, /if \(created\.completed\)/);
  assert.match(source, /else if \(!created\.created\)/);
  assert.match(source, /subscription\?\.synchronize\(sequence\)/);
});

test('workbench terminal detach does not stop its backend PTY', () => {
  assert.doesNotMatch(source, /stopWorkbenchPty/);
  assert.match(source, /Deliberately do not stop the PTY/);
});
