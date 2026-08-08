import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import { dingtalkPluginInstallBlocker } from './dingtalkPluginInstall';

function identity(overrides: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    runtimeId: null,
    targetFingerprint: 'target',
    connectionId: 'connection',
    endpoint: 'ws://127.0.0.1:18789',
    gatewayVersion: '2026.8.0',
    protocol: 3,
    stateDir: '/state',
    configPath: '/config',
    localStateDir: '/state',
    localConfigPath: '/config',
    deploymentKind: 'managed_child',
    ownership: 'junqi_managed',
    persistence: 'desktop_bound',
    installTarget: 'native_cli',
    endpointAttestation: 'matched',
    pathAttestation: 'matched',
    desktopMutationAllowed: false,
    desktopExitContinuity: false,
    verified: true,
    issues: [],
    authMode: null,
    methods: [],
    events: [],
    negotiatedRole: null,
    negotiatedScopes: [],
    supervisorLifecycle: 'running',
    supervisorPort: 18789,
    observedAtMs: 0,
    ...overrides,
  };
}

test('explains why a Gateway cannot receive a desktop plugin installation', () => {
  assert.match(dingtalkPluginInstallBlocker(null), /未读取当前 Gateway 身份/);
  assert.match(dingtalkPluginInstallBlocker(identity({ verified: false, issues: ['endpoint_mismatch'] })), /endpoint_mismatch/);
  assert.match(dingtalkPluginInstallBlocker(identity({ installTarget: 'remote_manual' })), /外部或远程 Gateway/);
  assert.match(dingtalkPluginInstallBlocker(identity({ endpointAttestation: 'mismatched' })), /端点未与 JunQi 管理/);
  assert.match(dingtalkPluginInstallBlocker(identity({ pathAttestation: 'mismatched' })), /运行时路径未与 JunQi 管理/);
});
