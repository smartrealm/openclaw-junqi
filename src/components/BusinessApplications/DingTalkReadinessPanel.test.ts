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
    pluginStatusPending: false,
    restartRequired: true,
    agentId: 'main',
  });

  assert.equal(readiness.action, 'restart-gateway');
  assert.equal(readiness.titleKey, 'restartRequiredTitle');
});

test('插件缺失且无需重启时提供 JunQi 安装入口', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: false,
    runtime: null,
    runtimeError: null,
    pluginNeedsInstall: true,
    pluginStatusPending: false,
    restartRequired: false,
    agentId: 'main',
  });

  assert.equal(readiness.action, 'install-plugin');
  assert.equal(readiness.titleKey, 'pluginMissingTitle');
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
    pluginStatusPending: false,
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
    pluginStatusPending: false,
    restartRequired: false,
    agentId: 'main',
  });

  assert.equal(readiness.action, 'authorize-dws');
});

test('插件状态未返回前不误报未安装或 Agent 未授权', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: false,
    runtime: null,
    runtimeError: null,
    pluginNeedsInstall: false,
    pluginStatusPending: true,
    restartRequired: false,
    agentId: 'main',
  });

  assert.equal(readiness.action, null);
  assert.equal(readiness.titleKey, 'checkingTitle');
});

test('当前 Session 缺少有效工具时不把快照缺失冒充为 Agent 未授权', () => {
  const readiness = resolveDingTalkReadiness({
    sessionExists: true,
    runtimeToolAvailable: false,
    runtime: null,
    runtimeError: null,
    pluginNeedsInstall: false,
    pluginStatusPending: false,
    restartRequired: false,
    agentId: 'main',
  });

  assert.equal(readiness.titleKey, 'effectiveToolMissingTitle');
  assert.equal(readiness.descriptionKey, 'effectiveToolMissingDescription');
  assert.equal(readiness.action, 'configure-agent');
});
