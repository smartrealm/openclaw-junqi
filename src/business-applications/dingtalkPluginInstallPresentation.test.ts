import assert from 'node:assert/strict';
import test from 'node:test';
import { dingtalkPluginInstallPresentation } from './dingtalkPluginInstallPresentation';

test('安装等待阶段不伪造百分比', () => {
  const presentation = dingtalkPluginInstallPresentation({
    phase: 'installing',
    message: '正在等待 Gateway 安装、启用',
  });

  assert.equal(presentation.active, true);
  assert.equal(presentation.progressValue, null);
  assert.equal(presentation.phaseLabel, '正在等待 Gateway 安装、启用');
  assert.equal(presentation.completed, false);
});

test('命令返回后才标记安装完成', () => {
  const presentation = dingtalkPluginInstallPresentation({ phase: 'completed', message: null });

  assert.equal(presentation.active, false);
  assert.equal(presentation.progressValue, 100);
  assert.equal(presentation.phaseLabel, '安装完成，等待重启 Gateway');
});
