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
    agentId: 'main',
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
    agentId: 'main',
  });

  assert.equal(readiness.action, 'install-plugin');
  assert.equal(readiness.title, '钉钉业务插件未就绪');
});

test('DWS 缺失时保留受控安装动作', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: true,
    runtime: {
      available: false,
      currentProfile: null,
      profiles: [],
      user: null,
      runtimeError: {
        code: 'DWS_RUNTIME_NOT_FOUND',
        message: '未找到 DWS',
      },
    },
    runtimeError: null,
    pluginNeedsInstall: false,
    restartRequired: false,
    agentId: 'main',
  });

  assert.equal(readiness.action, 'install-dws');
});

test('DWS 已安装但缺少 Profile 时保留官方授权动作', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: true,
    runtime: {
      available: true,
      currentProfile: null,
      profiles: [],
      user: null,
      runtimeError: null,
    },
    runtimeError: null,
    pluginNeedsInstall: false,
    restartRequired: false,
    agentId: 'main',
  });

  assert.equal(readiness.action, 'authorize-dws');
});
