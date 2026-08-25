import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CollaborationCapabilities } from '@/types/collaboration';
import type { CollaborationBootstrapProbe } from '@/types/collaborationBootstrap';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import type { CollaborationCapabilityFailure } from '@/stores/collaborationSetupStore';
import { CollaborationSetupPanel } from './CollaborationSetupDialog';

const identity = {
  runtimeId: 'instance-1',
  targetFingerprint: 'target-1',
  connectionId: 'connection-1',
  gatewayVersion: '2026.7.1',
  persistence: 'desktop_independent',
  deploymentKind: 'system_service',
  desktopExitContinuity: true,
  verified: true,
} as RuntimeIdentity;

const probe = {
  ok: true,
  code: 'BOOTSTRAP_READY',
  message: 'ready',
  targetFingerprint: 'target-1',
  connectionId: 'connection-1',
  targetClass: 'system_service',
  deploymentKind: 'system_service',
  ownership: 'junqi_managed',
  gatewayVersion: '2026.7.1',
  durableRuntime: true,
  mutationAllowed: true,
  manualInstallRequired: false,
  binaryPath: '/usr/local/bin/openclaw',
  stateDir: '/tmp/openclaw',
  configPath: '/tmp/openclaw/openclaw.json',
  plugin: { installed: true, enabled: true, status: 'loaded', version: '0.1.0' },
  warnings: [],
  manualInstallInstructions: null,
  busy: false,
  recoveryRequired: false,
  durableCollaborationState: 'present',
} satisfies CollaborationBootstrapProbe;

function capabilities(agents: CollaborationCapabilities['configuredAgents']): CollaborationCapabilities {
  return {
    collaborationInstanceId: 'instance-1',
    schemaVersion: 3,
    durableRuntime: true,
    configured: false,
    configuredAgents: agents,
    coordinatorAgentId: null,
    allowedAgentIds: [],
    repairs: ['Set coordinatorAgentId'],
    sessionCapabilities: { deleteExpectedSessionId: true, resetExpectedSessionId: false },
    maintenance: { active: false, lease: null, activeRuns: [] },
  };
}

function render(
  agentCapabilities: CollaborationCapabilities,
  allowedAgentIds: string[],
  options: {
    identity?: RuntimeIdentity;
    decision?: Parameters<typeof CollaborationSetupPanel>[0]['decision'];
    probe?: CollaborationBootstrapProbe;
    capabilityFailure?: CollaborationCapabilityFailure | null;
    mutation?: Parameters<typeof CollaborationSetupPanel>[0]['mutation'];
    error?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(createElement(CollaborationSetupPanel, {
    decision: options.decision ?? {
      kind: 'ready',
      canApply: false,
      canRecover: false,
      targetClass: 'system_service',
      pluginVersion: '0.1.0',
      expectedVersion: '0.1.0',
    },
    loading: false,
    identity: options.identity ?? identity,
    probe: options.probe ?? probe,
    status: null,
    capabilities: agentCapabilities,
    capabilityFailure: options.capabilityFailure ?? null,
    agentConfiguration: {
      coordinatorAgentId: agentCapabilities.configuredAgents[0]?.id ?? null,
      allowedAgentIds,
      touched: true,
    },
    bundle: {
      pluginVersion: '0.1.0',
      schemaVersion: 3,
      sha256: 'a'.repeat(64),
      archiveFile: 'junqi-collab.tgz',
    },
    mutation: options.mutation ?? null,
    lastResult: null,
    error: options.error ?? null,
    restartAvailable: false,
    rollbackConfirmed: false,
    onRollbackConfirmedChange: () => undefined,
    orphanAbandonConfirmed: false,
    onOrphanAbandonConfirmedChange: () => undefined,
    onRefresh: () => undefined,
    onApply: () => undefined,
    onSelectCoordinator: () => undefined,
    onSetAgentAllowed: () => undefined,
    onConfigureAgents: () => undefined,
    onCreateAgent: () => undefined,
    onRecover: () => undefined,
    onAbandonOrphan: () => undefined,
    onRestart: () => undefined,
  }));
}

test('setup panel renders an operable coordinator and explicit Agent allowlist', () => {
  const html = render(capabilities([
    { id: 'coordinator', name: 'Coordinator', runtimeType: 'native', allowed: false, coordinator: false },
    { id: 'research', name: 'Research', runtimeType: 'acp', allowed: false, coordinator: false },
  ]), ['coordinator', 'research']);

  assert.match(html, /Agent policy/);
  assert.match(html, /Coordinator/);
  assert.match(html, /Research/);
  assert.match(html, /Allowed Agents/);
  assert.match(html, /Save policy/);
  assert.match(html, /type="checkbox"/);
});

test('setup panel closes the zero-Agent dead end with a create action', () => {
  const html = render(capabilities([]), []);
  assert.match(html, /No OpenClaw Agent is configured/);
  assert.match(html, /Create Agent/);
});

test('unverified Gateway setup does not expose a plugin package or target metadata', () => {
  const html = render(capabilities([]), [], {
    identity: { ...identity, verified: false },
    decision: {
      kind: 'identity_unavailable',
      canApply: false,
      canRecover: false,
      targetClass: 'unknown',
      pluginVersion: null,
      expectedVersion: '0.1.0',
    },
  });

  assert.match(html, /Verified Gateway required/);
  assert.doesNotMatch(html, /Fixed plugin package|SHA-256|Plugin state/);
});

test('a post-restart schema failure exposes runtime evidence without presenting rollback as a fix', () => {
  const html = render(capabilities([]), [], {
    decision: {
      kind: 'service_failed',
      canApply: false,
      canRecover: true,
      targetClass: 'system_service',
      pluginVersion: '0.1.0',
      expectedVersion: '0.1.0',
    },
    capabilityFailure: {
      code: 'DATABASE_SCHEMA_UNSUPPORTED',
      message: 'The collaboration database schema is not supported by this plugin',
      details: {
        pluginVersion: '0.1.0',
        actualSchemaVersion: 11,
        expectedSchemaVersion: 15,
      },
    },
  });

  assert.match(html, /协作数据版本不兼容|Collaboration data version is incompatible/);
  assert.match(html, /运行中插件|Loaded plugin/);
  assert.match(html, />11</);
  assert.match(html, />15</);
  assert.doesNotMatch(html, /建议恢复安装前状态|Restore the pre-installation state/);
  assert.doesNotMatch(html, /58%|82%/);
});

test('a startup failure without a recovery transaction does not render a rollback section', () => {
  const html = render(capabilities([]), [], {
    decision: {
      kind: 'service_failed',
      canApply: false,
      canRecover: false,
      targetClass: 'system_service',
      pluginVersion: '0.1.0',
      expectedVersion: '0.1.0',
    },
    capabilityFailure: {
      code: 'SERVICE_START_FAILED',
      message: 'The collaboration plugin service failed to start',
      details: { pluginVersion: '0.1.0' },
    },
  });

  assert.match(html, /运行中插件|Loaded plugin/);
  assert.doesNotMatch(html, /可选：恢复安装前状态|Optional: restore the pre-installation state/);
});

test('restart without a live Gateway event uses indeterminate progress', () => {
  const html = render(capabilities([]), [], { mutation: 'restart' });
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(html, /aria-valuenow|58%|82%/);
});

test('setup panel does not expose raw runtime errors as the primary user message', () => {
  const html = render(capabilities([]), [], {
    decision: {
      kind: 'error',
      canApply: false,
      canRecover: false,
      targetClass: 'unknown',
      pluginVersion: null,
      expectedVersion: '0.1.0',
      blockedReason: 'runtime path /private/secret-state cannot be inspected',
    },
    error: 'runtime path /private/secret-state cannot be inspected',
  });

  assert.match(html, /协作运行环境操作失败|The collaboration runtime operation failed/);
  assert.doesNotMatch(html, /private\/secret-state/);
});

test('external Gateway handoff is semantic and does not expose client paths or shell commands', () => {
  const html = render(capabilities([]), [], {
    decision: {
      kind: 'manual',
      canApply: false,
      canRecover: false,
      targetClass: 'external_remote',
      pluginVersion: null,
      expectedVersion: '0.1.0',
    },
    probe: {
      ...probe,
      targetClass: 'external_remote',
      mutationAllowed: false,
      manualInstallRequired: true,
      manualInstallInstructions: null,
    },
  });

  assert.match(html, /Gateway administrator action required/);
  assert.match(html, /fixed plugin package junqi-collab\.tgz/i);
  assert.doesNotMatch(html, /\/tmp\/junqi-collab\.tgz/);
  assert.doesNotMatch(html, /sha256sum|openclaw plugins install|gateway restart/);
});
