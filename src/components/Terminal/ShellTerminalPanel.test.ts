import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ShellTerminalPanel.tsx', import.meta.url), 'utf8');

test('terminal tab context menu exposes every documented close operation', () => {
  assert.match(source, /onCloseAll\?: \(\) => void/);
  assert.match(source, /file\.closeAllTabs/);
  assert.match(source, /shells\.forEach\(recordClosedTerminalShell\)/);
  assert.match(source, /setShells\(\[\]\)/);
  assert.match(source, /onClose\(\)/);
});

test('terminal tab context menu stays within the viewport and dismisses predictably', () => {
  assert.match(source, /Math\.max\(4, Math\.min\(ctxMenu\.x/);
  assert.match(source, /Math\.max\(4, Math\.min\(ctxMenu\.y/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /window\.addEventListener\('resize', dismiss\)/);
  assert.match(source, /window\.addEventListener\('blur', dismiss\)/);
});
