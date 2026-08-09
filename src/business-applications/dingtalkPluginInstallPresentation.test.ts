import assert from 'node:assert/strict';
import test from 'node:test';
import { dingtalkPluginInstallPresentation } from './dingtalkPluginInstallPresentation';

test('keeps plugin installation progress in a verifiable waiting phase', () => {
  const presentation = dingtalkPluginInstallPresentation({
    phase: 'installing',
    message: '正在等待 Gateway 安装、启用',
  });

  assert.equal(presentation.active, true);
  assert.equal(presentation.progressValue, 60);
  assert.equal(presentation.phaseLabel, '正在等待 Gateway 安装、启用');
  assert.equal(presentation.completed, false);
});

test('marks the plugin installation complete only after the command returns', () => {
  const presentation = dingtalkPluginInstallPresentation({ phase: 'completed', message: null });

  assert.equal(presentation.active, false);
  assert.equal(presentation.progressValue, 100);
  assert.equal(presentation.phaseLabel, '安装完成，等待重启 Gateway');
});
