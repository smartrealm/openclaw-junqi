import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./generate-provider-catalog.js', import.meta.url), 'utf8');

test('BUG-MP-05 generator is ESM and binds generation to an isolated official OpenClaw CLI', () => {
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.match(source, /OPENCLAW_CONFIG_PATH/);
  assert.match(source, /OPENCLAW_BIN/);
  assert.match(source, /node_modules\/\.bin/);
  assert.match(source, /shell: process\.platform === 'win32'/);
  assert.match(source, /--allow-template-fallback/);
});
