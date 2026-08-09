import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOutputFilePath } from '@/utils/fileOutputPath';

test('resolves a relative output against the session workspace', () => {
  assert.equal(
    resolveOutputFilePath({ path: '都市骑手-短篇.md', kind: 'path' }, '/Users/wei/.openclaw/workspace'),
    '/Users/wei/.openclaw/workspace/都市骑手-短篇.md',
  );
});

test('uses only the session workspace and refuses untrusted absolute paths or traversal', () => {
  assert.equal(
    resolveOutputFilePath({ path: '/Users/wei/workspace/report.md', workspaceRoot: '/untrusted' }, '/Users/wei/workspace'),
    '/Users/wei/workspace/report.md',
  );
  assert.equal(resolveOutputFilePath({ path: '/tmp/report.md', workspaceRoot: '/tmp' }, '/Users/wei/workspace'), null);
  assert.equal(resolveOutputFilePath({ path: 'file:///tmp/report.md' }, '/Users/wei/workspace'), null);
  assert.equal(resolveOutputFilePath({ path: '../secret.md', workspaceRoot: '/Users/wei/workspace' }), null);
});
