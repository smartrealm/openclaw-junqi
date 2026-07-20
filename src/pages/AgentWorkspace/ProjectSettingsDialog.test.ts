import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ProjectSettingsDialog.tsx', import.meta.url), 'utf8');

test('project settings normalize legacy commit timeout values like Nezha', () => {
  assert.match(source, /commit_message_timeout_secs\?\: number/);
  assert.match(source, /DEFAULT_COMMIT_MESSAGE_TIMEOUT_SECS = 15/);
  assert.match(source, /MIN_COMMIT_MESSAGE_TIMEOUT_SECS = 1/);
  assert.match(source, /MAX_COMMIT_MESSAGE_TIMEOUT_SECS = 120/);
  assert.match(source, /inputMode="numeric"/);
  assert.match(source, /if \(!\/\^\\d\+\$\/\.test\(value\)\) return/);
  assert.match(source, /if \(!commitMessageTimeoutSecs\) setCommitMessageTimeoutSecs/);
});

test('project settings always persist a validated numeric timeout', () => {
  assert.match(source, /const timeout = Number\(commitMessageTimeoutSecs\)/);
  assert.match(source, /commit_message_timeout_secs: timeout/);
});
