import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ProvidersTab.tsx', import.meta.url), 'utf8');

test('provider authentication refreshes bypass the official status cache after explicit actions', () => {
  assert.match(source, /await modelAuthStatus\.refresh\(\{ force: true \}\)/);
  assert.match(source, /onRefresh=\{\(\) => \{ void modelAuthStatus\.refresh\(\{ force: true \}\); \}\}/);
});
