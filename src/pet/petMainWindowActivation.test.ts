import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldActivateMainWindow } from './petMainWindowActivation';

test('普通点击宠物时恢复主窗口', () => {
  assert.equal(shouldActivateMainWindow(false), true);
});

test('拖动宠物后的点击事件不恢复主窗口', () => {
  assert.equal(shouldActivateMainWindow(true), false);
});
