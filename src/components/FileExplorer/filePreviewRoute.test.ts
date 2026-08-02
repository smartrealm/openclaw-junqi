import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFilePreviewRoute, parseFilePreviewRoute } from './filePreviewRoute';

test('file preview routes preserve encoded roots and open a descendant file', () => {
  const route = createFilePreviewRoute('/Users/wei/My Project', '/Users/wei/My Project/docs/README.md');
  const selection = parseFilePreviewRoute(new URL(route, 'http://localhost').searchParams);

  assert.equal(selection.treeRequested, true);
  assert.equal(selection.projectPath, '/Users/wei/My Project');
  assert.deepEqual(selection.file, {
    path: '/Users/wei/My Project/docs/README.md',
    name: 'README.md',
  });
});

test('file preview routes reject files outside the requested root', () => {
  const selection = parseFilePreviewRoute(new URLSearchParams({
    view: 'tree',
    path: '/Users/wei/project',
    file: '/Users/wei/other/secret.md',
  }));

  assert.equal(selection.treeRequested, true);
  assert.equal(selection.projectPath, '/Users/wei/project');
  assert.equal(selection.file, null);
});

test('root filesystem routes still accept descendants', () => {
  const selection = parseFilePreviewRoute(new URLSearchParams({
    path: '/',
    file: '/tmp/readme.md',
  }));
  assert.equal(selection.file?.path, '/tmp/readme.md');
});

test('terminal file opening and file-manager routing use the shared preview route', () => {
  const terminal = readFileSync(new URL('../../pages/TerminalPage/index.tsx', import.meta.url), 'utf8');
  const fileManager = readFileSync(new URL('../../pages/file-manager/WorkspaceFileManager.tsx', import.meta.url), 'utf8');
  assert.match(terminal, /navigate\(createFilePreviewRoute\(root, filePath\)\)/);
  assert.match(terminal, /<TerminalWorkspaceFiles[\s\S]*onFileOpen=\{\(entry\) => onOpenFile\(entry\.path\)\}/);
  assert.match(fileManager, /parseFilePreviewRoute\(new URLSearchParams\(routeKey\)\)/);
  assert.match(fileManager, /if \(route\.file\) openFile\(route\.file\.path, route\.file\.name\)/);
});
