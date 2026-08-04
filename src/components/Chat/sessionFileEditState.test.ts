import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canEditSessionFile,
  hasUniformSessionFileLineEndings,
  sessionFileDraftKey,
  sessionFileLineSeparator,
} from './sessionFileEditState';

const hash = 'a'.repeat(64);

test('会话文件编辑只接受带哈希的 UTF-8 文本预览', () => {
  const editable = {
    path: 'src/main.ts', name: 'main.ts', kind: 'modified' as const, missing: false,
    content: 'export {};\n', hash, contentEncoding: 'utf8' as const, previewKind: 'text' as const,
  };
  assert.equal(canEditSessionFile(editable), true);
  assert.equal(canEditSessionFile({ ...editable, hash: 'invalid' }), false);
  assert.equal(canEditSessionFile({ ...editable, contentEncoding: 'base64' }), false);
  assert.equal(canEditSessionFile({ ...editable, previewKind: 'image' }), false);
  assert.equal(canEditSessionFile({ ...editable, content: 'one\r\ntwo\n' }), false);
});

test('会话文件编辑保留 OpenClaw 的统一换行边界与原始分隔符', () => {
  assert.equal(hasUniformSessionFileLineEndings('without ending'), true);
  assert.equal(hasUniformSessionFileLineEndings('one\ntwo\n'), true);
  assert.equal(hasUniformSessionFileLineEndings('one\r\ntwo\r\n'), true);
  assert.equal(hasUniformSessionFileLineEndings('one\rtwo\r'), true);
  assert.equal(hasUniformSessionFileLineEndings('one\rtwo\n'), false);
  assert.equal(sessionFileLineSeparator('one\ntwo'), undefined);
  assert.equal(sessionFileLineSeparator('one\r\ntwo'), '\r\n');
  assert.equal(sessionFileLineSeparator('one\rtwo'), '\r');
});

test('会话文件草稿按 Gateway 连接与会话工作区隔离', () => {
  const base = {
    connectionId: 'gateway-a', sessionKey: 'agent:main:session-1', agentId: 'main',
    root: '/workspace-a', path: 'src/main.ts',
  };
  assert.notEqual(sessionFileDraftKey(base), sessionFileDraftKey({ ...base, connectionId: 'gateway-b' }));
  assert.notEqual(sessionFileDraftKey(base), sessionFileDraftKey({ ...base, sessionKey: 'agent:main:session-2' }));
  assert.notEqual(sessionFileDraftKey(base), sessionFileDraftKey({ ...base, root: '/workspace-b' }));
  assert.notEqual(sessionFileDraftKey(base), sessionFileDraftKey({ ...base, path: 'src/other.ts' }));
});
