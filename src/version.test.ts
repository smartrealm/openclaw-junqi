import assert from 'node:assert/strict';
import test from 'node:test';

import { APP_VERSION } from './version';

test('app version uses the build-time value with a safe fallback', () => {
  const injected = (globalThis as { __APP_VERSION__?: unknown }).__APP_VERSION__;
  assert.equal(APP_VERSION, typeof injected === 'string' && injected ? injected : 'dev');
});
