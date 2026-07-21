import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CollaborationCapabilities } from '@/services/collaboration/types';
import type { CollaborationBootstrapProbe } from '@/types/collaborationBootstrap';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
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

function render(agentCapabilities: CollaborationCapabilities, allowedAgentIds: string[]): string {
  return renderToStaticMarkup(createElement(CollaborationSetupPanel, {
    decision: {
      kind: 'ready',
      canApply: false,
      canRecover: false,
      targetClass: 'system_service',
      pluginVersion: '0.1.0',
      expectedVersion: '0.1.0',
    },
    identity,
    probe,
    status: null,
    capabilities: agentCapabilities,
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
    resolvedBundlePath: '/tmp/junqi-collab.tgz',
    mutation: null,
    lastResult: null,
    error: null,
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
