import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('session lifecycle polling keeps the Gateway request receiver bound', () => {
  const source = readFileSync('src/stores/gatewayDataStore.ts', 'utf8');
  assert.match(
    source,
    /listOpenClawSessionLifecycle\(\s*\(method, params\) => ticket\.connection\.request\(method, params\)/,
  );
  assert.doesNotMatch(source, /listOpenClawSessionLifecycle\(ticket\.connection\.request\)/);
});
