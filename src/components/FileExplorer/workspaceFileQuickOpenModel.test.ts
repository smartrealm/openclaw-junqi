import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextWorkspaceFileQuickOpenIndex,
  shouldOpenWorkspaceFileQuickOpen,
} from './workspaceFileQuickOpenModel';

test('工作区快速打开只响应非编辑区的跨平台快捷键', () => {
  assert.equal(shouldOpenWorkspaceFileQuickOpen({
    key: 'p', ctrlKey: true, metaKey: false, altKey: false, targetIsEditable: false,
  }), true);
  assert.equal(shouldOpenWorkspaceFileQuickOpen({
    key: 'P', ctrlKey: false, metaKey: true, altKey: false, targetIsEditable: false,
  }), true);
  assert.equal(shouldOpenWorkspaceFileQuickOpen({
    key: 'p', ctrlKey: true, metaKey: false, altKey: false, targetIsEditable: true,
  }), false);
  assert.equal(shouldOpenWorkspaceFileQuickOpen({
    key: 'p', ctrlKey: true, metaKey: false, altKey: true, targetIsEditable: false,
  }), false);
});

test('工作区快速打开的结果选择可循环移动', () => {
  assert.equal(nextWorkspaceFileQuickOpenIndex(-1, 3, 'next'), 0);
  assert.equal(nextWorkspaceFileQuickOpenIndex(-1, 3, 'previous'), 2);
  assert.equal(nextWorkspaceFileQuickOpenIndex(2, 3, 'next'), 0);
  assert.equal(nextWorkspaceFileQuickOpenIndex(0, 3, 'previous'), 2);
  assert.equal(nextWorkspaceFileQuickOpenIndex(0, 0, 'next'), -1);
});
