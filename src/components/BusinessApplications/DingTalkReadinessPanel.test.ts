import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDingTalkReadiness } from './dingTalkReadiness';

test('插件已更新时优先引导重启 Gateway', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: false,
    runtime: null,
    runtimeError: null,
    pluginNeedsInstall: true,
    restartRequired: true,
  });

  assert.equal(readiness.action, 'restart-gateway');
  assert.equal(readiness.title, '等待 Gateway 加载插件');
});

test('插件缺失且无需重启时提供 JunQi 安装入口', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: false,
    runtime: null,
    runtimeError: null,
    pluginNeedsInstall: true,
    restartRequired: false,
  });

  assert.equal(readiness.action, 'install-plugin');
  assert.equal(readiness.title, '钉钉业务插件未就绪');
});
