import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkspacePreview } from './previewResolver';

const rw = { read: true, write: true, nativePreview: true };

test('resolver chooses editors and limits writes to workspace policy', () => {
  assert.deepEqual(resolveWorkspacePreview({ path: 'a.ts', policy: 'workspace', capabilities: rw }), {
    kind: 'code', mode: 'editor', editable: true,
  });
  assert.equal(resolveWorkspacePreview({ path: 'a.ts', policy: 'managed-readonly', capabilities: rw }).editable, false);
  assert.equal(resolveWorkspacePreview({ path: 'a.ts', policy: 'terminal-strict', capabilities: rw }).editable, false);
});

test('strict JSON files use the shared formatted preview while JSONC stays source-first', () => {
  assert.deepEqual(resolveWorkspacePreview({ path: 'config.json', policy: 'workspace', capabilities: rw }), {
    kind: 'code', mode: 'json', editable: true,
  });
  assert.equal(resolveWorkspacePreview({ path: 'config.jsonc', policy: 'workspace', capabilities: rw }).mode, 'editor');
});

test('HTML and media require explicit scoped native preview capability', () => {
  assert.equal(resolveWorkspacePreview({ path: 'index.html', policy: 'managed-readonly', capabilities: rw, interactiveHtml: true }).mode, 'isolated-html');
  assert.equal(resolveWorkspacePreview({ path: 'index.html', policy: 'managed-readonly', capabilities: { ...rw, nativePreview: false }, interactiveHtml: true }).mode, 'static-html');
  assert.equal(resolveWorkspacePreview({ path: 'movie.mp4', policy: 'workspace', capabilities: { ...rw, nativePreview: false } }).mode, 'unsupported');
  assert.equal(resolveWorkspacePreview({ path: 'report.pdf', policy: 'workspace', capabilities: rw }).mode, 'scoped-pdf');
});

test('oversized inline text fails closed to native-only or unsupported', () => {
  assert.equal(resolveWorkspacePreview({ path: 'large.log', policy: 'workspace', capabilities: rw, byteSize: 3 * 1024 * 1024 }).mode, 'native-only');
  assert.equal(resolveWorkspacePreview({ path: 'large.log', policy: 'workspace', capabilities: { ...rw, nativePreview: false }, byteSize: 3 * 1024 * 1024 }).mode, 'unsupported');
});
