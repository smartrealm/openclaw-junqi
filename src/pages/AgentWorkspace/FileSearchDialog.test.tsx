import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentWorkspaceFileSearchDialog } from './FileSearchDialog';

test('agent workspace file search renders project search controls', () => {
  const html = renderToStaticMarkup(createElement(AgentWorkspaceFileSearchDialog, {
    projectPath: '/repo',
    onFileOpen: () => {},
    onClose: () => {},
  }));

  assert.match(html, /搜索当前项目文件/);
  assert.match(html, /全部类型/);
  assert.match(html, /输入名称开始搜索/);
});
