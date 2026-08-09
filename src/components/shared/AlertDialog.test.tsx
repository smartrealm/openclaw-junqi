import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmProgress } from './AlertDialog';

test('确认操作进行时展示不伪造百分比的不定进度条', () => {
  const html = renderToStaticMarkup(createElement(ConfirmProgress, {
    active: true,
    label: '安装钉钉业务插件进行中',
  }));

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aegis-indeterminate-progress/);
  assert.doesNotMatch(html, /aria-valuenow/);
});

test('确认操作空闲时不占用对话框空间', () => {
  const html = renderToStaticMarkup(createElement(ConfirmProgress, {
    active: false,
    label: '安装钉钉业务插件进行中',
  }));

  assert.equal(html, '');
});
