import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTerminalWorkspacePathDrop,
  serializeTerminalWorkspacePathDrop,
} from './terminalWorkspacePathDrop';

test('terminal workspace path drop round-trips a valid payload', () => {
  const payload = { path: '/tmp/project/file name.txt', projectPath: '/tmp/project' };
  assert.deepEqual(
    parseTerminalWorkspacePathDrop(serializeTerminalWorkspacePathDrop(payload)),
    payload,
  );
});

test('terminal workspace path drop rejects malformed and unsafe data', () => {
  assert.equal(parseTerminalWorkspacePathDrop('not json'), null);
  assert.equal(parseTerminalWorkspacePathDrop(JSON.stringify({ path: '', projectPath: '/tmp' })), null);
  assert.equal(parseTerminalWorkspacePathDrop(JSON.stringify({ path: '/tmp/a\0b', projectPath: '/tmp' })), null);
  assert.equal(parseTerminalWorkspacePathDrop(JSON.stringify({ path: '/tmp/file' })), null);
});
