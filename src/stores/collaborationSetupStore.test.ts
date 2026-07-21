import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLABORATION_PLUGIN_BUNDLE,
  type CollaborationPluginBundleMetadata,
} from '@/services/collaboration/bundledPlugin';
import type { CollaborationCapabilities } from '@/services/collaboration/types';
import type {
  BootstrapConfigureParams,
  BootstrapAbandonParams,
  BootstrapRecoverParams,
  BootstrapRestartParams,
  CollaborationBootstrapProbe,
  CollaborationBootstrapStatus,
} from '@/types/collaborationBootstrap';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  collaborationConfigurationMatches,
  createHealthConfirmation,
  createCollaborationSetupStore,
  deriveCollaborationSetupView,
  reconcileAgentConfiguration,
  type CollaborationSetupDependencies,
} from './collaborationSetupStore';

const bundle: CollaborationPluginBundleMetadata = {
  ...COLLABORATION_PLUGIN_BUNDLE,
  sha256: 'a'.repeat(64),
};

function identity(overrides: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    runtimeId: 'instance-1',
    targetFingerprint: 'target-1',
    connectionId: 'connection-1',
    endpoint: 'ws://127.0.0.1:18789/',
    gatewayVersion: '2026.7.1',
    protocol: 4,
    stateDir: '/tmp/openclaw',
    configPath: '/tmp/openclaw/openclaw.json',
    localStateDir: '/tmp/openclaw',
    localConfigPath: '/tmp/openclaw/openclaw.json',
    deploymentKind: 'system_service',
    ownership: 'junqi_managed',
    persistence: 'desktop_independent',
    installTarget: 'native_cli',
    endpointAttestation: 'matched',
    pathAttestation: 'matched',
    desktopMutationAllowed: true,
    desktopExitContinuity: true,
    verified: true,
    issues: [],
    authMode: 'token',
    methods: ['junqi.collab.capabilities'],
    events: ['junqi-collab.changed'],
    negotiatedRole: 'operator',
    negotiatedScopes: ['operator.read', 'operator.write'],
    supervisorLifecycle: 'running',
    supervisorPort: 18789,
    observedAtMs: 1,
    ...overrides,
  };
}

function capabilities(configured: boolean): CollaborationCapabilities {
  return {
    collaborationInstanceId: 'instance-1',
    pluginId: 'junqi-collab',
    schemaVersion: bundle.schemaVersion,
    pluginVersion: bundle.pluginVersion,
    runtimeVersion: '2026.7.1',
    databaseIntegrity: 'ok',
    durableState: true,
    durableRuntime: true,
    durableRuntimeDetails: { supported: true, required: true, reason: null },
    features: {
      SQLITE_AUTHORITY: true,
      COMMAND_OUTBOX: true,
      TASK_RECONCILE: true,
      EXACT_TRANSCRIPT_DELIVERY: true,
      EXACT_TRANSCRIPT_IDENTITY: true,
      PLUGIN_SUBAGENT_TASK_LOOKUP: true,
      PLUGIN_SUBAGENT_TASK_CANCEL: true,
      EVENT_CURSOR: true,
      SESSION_DELETE_CAS: true,
      WRITE_INSTANCE_FENCE: true,
    },
    featureEvidence: {
      kind: 'DECLARED_PLUGIN_CONTRACT',
      behaviorVerified: false,
      structuralChecks: {
        pluginServiceStarted: true,
        databaseIntegrity: 'ok',
        configured,
      },
      requiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
    },
    configured,
    configuredAgents: [
      { id: 'coordinator', name: 'Coordinator', runtimeType: 'native', allowed: configured, coordinator: configured },
      { id: 'worker', name: 'Worker', runtimeType: 'native', allowed: configured, coordinator: false },
    ],
    coordinatorAgentId: configured ? 'coordinator' : null,
    allowedAgentIds: configured ? ['coordinator', 'worker'] : [],
    repairs: configured ? [] : ['Set coordinatorAgentId', 'Set allowedAgentIds'],
    trustTier: 'portable-core',
    workboard: { supported: false, reason: 'trusted-official runtime is not available' },
    sessionCapabilities: { deleteExpectedSessionId: true, resetExpectedSessionId: false },
    maintenance: {
      active: false,
      lease: null,
      activeRuns: [],
      activeRunCount: 0,
      activeRunsTruncated: false,
    },
  };
}

function probe(): CollaborationBootstrapProbe {
  return {
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
    plugin: { installed: true, enabled: true, status: 'loaded', version: bundle.pluginVersion },
    warnings: [],
    manualInstallInstructions: null,
    busy: false,
    recoveryRequired: false,
    durableCollaborationState: 'present',
  };
}

function status(healthPending = false): CollaborationBootstrapStatus {
  return {
    busy: false,
    recoveryRequired: false,
    recoverable: healthPending,
    targetFingerprint: 'target-1',
    journal: healthPending ? {
      version: 1,
      operationId: 'operation-1',
      operation: 'apply',
      status: 'completed',
      target: {
        targetFingerprint: 'target-1',
        connectionId: 'connection-1',
        deploymentKind: 'system_service',
        ownership: 'junqi_managed',
        gatewayVersion: '2026.7.1',
        binaryPath: '/usr/local/bin/openclaw',
        stateDir: '/tmp/openclaw',
        configPath: '/tmp/openclaw/openclaw.json',
      },
      package: {
        sourceTgzPath: '/tmp/junqi-collab.tgz',
        hostTgzPath: '/tmp/junqi-collab.tgz',
        tgzPath: '/tmp/junqi-collab.tgz',
        sha256: bundle.sha256,
        pluginId: 'junqi-collab',
        pluginVersion: bundle.pluginVersion,
      },
      originalPlugin: { installed: false, enabled: false },
      originalConfigSha256: 'b'.repeat(64),
      startedAtMs: 1,
      updatedAtMs: 2,
      restartRequired: true,
      healthPending: true,
      steps: [],
      diagnostics: [],
    } : null,
  };
}

function dependencies(options: {
  healthPending?: boolean;
  onConfigure?: (params: BootstrapConfigureParams) => void;
  onRecover?: (params: BootstrapRecoverParams) => void;
  onAbandon?: (params: BootstrapAbandonParams) => void;
  onRestart?: (params: BootstrapRestartParams) => void;
  onProbe?: (targetFingerprint?: string, expectedConnectionId?: string) => void;
  changeTargetAfterConfigure?: boolean;
  maintenanceActive?: boolean;
  initialIdentity?: RuntimeIdentity;
  probeOverride?: CollaborationBootstrapProbe;
  statusOverride?: CollaborationBootstrapStatus;
} = {}): CollaborationSetupDependencies {
  let currentIdentity = options.initialIdentity ?? identity();
  let liveCapabilities = capabilities(false);
  if (options.maintenanceActive) {
    liveCapabilities = {
      ...liveCapabilities,
      maintenance: {
        active: true,
        lease: { id: 'maintenance-1' },
        activeRuns: [],
        activeRunCount: 0,
        activeRunsTruncated: false,
      },
    };
  }
  return {
    bundle,
    eventTarget: undefined,
    getRuntimeIdentity: () => currentIdentity,
    subscribeRuntimeIdentity: () => () => undefined,
    bindRuntimeIdentity: (instanceId, connectionId) => {
      if (connectionId !== currentIdentity.connectionId) return null;
      currentIdentity = { ...currentIdentity, runtimeId: instanceId };
      return currentIdentity;
    },
    resolveBundle: async () => ({ ...bundle, tgzPath: '/tmp/junqi-collab.tgz' }),
    reloadCapabilities: async () => liveCapabilities,
    wait: async () => undefined,
    service: {
      probe: async (targetFingerprint, expectedConnectionId) => {
        options.onProbe?.(targetFingerprint, expectedConnectionId);
        return options.probeOverride ?? probe();
      },
      status: async () => options.statusOverride ?? status(options.healthPending),
      apply: async () => { throw new Error('not used'); },
      recover: async (params) => {
        options.onRecover?.(params);
        return {
          ok: true,
          code: 'BOOTSTRAP_ROLLED_BACK',
          message: 'rolled back',
          operationId: 'operation-1',
          targetFingerprint: 'target-1',
          action: 'rollback',
          plugin: null,
          restartRequired: true,
          healthPending: false,
          recoverable: false,
          warnings: [],
        };
      },
      abandon: async (params) => {
        options.onAbandon?.(params);
        return {
          ok: true,
          code: 'BOOTSTRAP_ABANDONED',
          message: 'archived',
          operationId: params.operationId,
          orphanTargetFingerprint: params.orphanTargetFingerprint,
          currentTargetFingerprint: params.currentTargetFingerprint,
          evidenceRetained: true,
          applyUnblocked: true,
        };
      },
      confirmHealth: async () => { throw new Error('not used'); },
      configure: async (params) => {
        options.onConfigure?.(params);
        liveCapabilities = capabilities(true);
        if (options.changeTargetAfterConfigure) {
          currentIdentity = identity({ targetFingerprint: 'target-2', connectionId: 'connection-2' });
        }
        return {
          ok: true,
          code: 'COLLABORATION_CONFIGURED',
          message: 'configured',
          targetFingerprint: 'target-1',
          connectionId: 'connection-1',
          coordinatorAgentId: 'coordinator',
          allowedAgentIds: ['coordinator', 'worker'],
          configuredAgentIds: ['coordinator', 'worker'],
          coordinatorPolicyUpdated: true,
          reloadExpected: true,
          warnings: [],
        };
      },
      restart: async (params) => {
        options.onRestart?.(params);
        return {
          ok: true,
          code: 'GATEWAY_RESTART_REQUESTED',
          message: 'restart requested',
          operationId: 'operation-1',
          targetFingerprint: 'target-1',
          previousConnectionId: 'connection-1',
          targetClass: 'system_service',
          restartRequested: true,
          reconnectRequired: true,
          healthPending: true,
        };
      },
    },
  };
}

test('Agent configuration reconciliation drops stale ids and always keeps the coordinator allowed', () => {
  const reconciled = reconcileAgentConfiguration(capabilities(false), {
    coordinatorAgentId: 'worker',
    allowedAgentIds: ['missing'],
    touched: true,
  });
  assert.deepEqual(reconciled, {
    coordinatorAgentId: 'worker',
    allowedAgentIds: ['worker'],
    touched: true,
  });
  assert.equal(collaborationConfigurationMatches(capabilities(true), 'coordinator', ['worker']), false);
  assert.equal(collaborationConfigurationMatches(capabilities(true), 'coordinator', ['coordinator', 'worker']), true);
});

test('setup store configures an exact Gateway connection and waits for the live plugin contract', async () => {
  let received: BootstrapConfigureParams | undefined;
  const store = createCollaborationSetupStore(dependencies({ onConfigure: (params) => { received = params; } }));
  await store.getState().refresh();
  store.getState().setAgentAllowed('worker', true);
  await store.getState().configureAgents();

  assert.deepEqual(received, {
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
    coordinatorAgentId: 'coordinator',
    allowedAgentIds: ['coordinator', 'worker'],
  });
  assert.equal(store.getState().capabilities?.configured, true);
  assert.equal(store.getState().error, null);
});

test('setup refresh binds its probe to the exact live Gateway connection', async () => {
  const calls: Array<[string | undefined, string | undefined]> = [];
  const store = createCollaborationSetupStore(dependencies({
    onProbe: (targetFingerprint, expectedConnectionId) => {
      calls.push([targetFingerprint, expectedConnectionId]);
    },
  }));

  await store.getState().refresh();

  assert.deepEqual(calls, [['target-1', 'connection-1']]);
});

test('setup store rejects a configuration acknowledgement after the active target changes', async () => {
  const store = createCollaborationSetupStore(dependencies({ changeTargetAfterConfigure: true }));
  await store.getState().refresh();
  store.getState().setAgentAllowed('worker', true);
  await store.getState().configureAgents();

  assert.match(store.getState().error ?? '', /target changed/i);
  assert.notEqual(store.getState().capabilities?.configured, true);
});

test('setup store does not mutate Agent policy while collaboration maintenance is active', async () => {
  let configureCalls = 0;
  const store = createCollaborationSetupStore(dependencies({
    maintenanceActive: true,
    onConfigure: () => { configureCalls += 1; },
  }));
  await store.getState().refresh();
  store.getState().setAgentAllowed('worker', true);
  await store.getState().configureAgents();

  assert.equal(configureCalls, 0);
  assert.match(store.getState().error ?? '', /maintenance/i);
});

test('setup restart is fenced to the health-pending operation, target, and connection', async () => {
  let received: BootstrapRestartParams | undefined;
  const store = createCollaborationSetupStore(dependencies({
    healthPending: true,
    onRestart: (params) => { received = params; },
  }));
  await store.getState().refresh();
  await store.getState().requestRestart();

  assert.deepEqual(received, {
    operationId: 'operation-1',
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
  });
  assert.equal(store.getState().lastResult?.code, 'GATEWAY_RESTART_REQUESTED');
  assert.equal(store.getState().restartAvailable, false);
});

test('completed health pending exposes rollback and rolled-back state remains restartable', async () => {
  const completed = status(true);
  const baseState = {
    identity: identity(),
    probe: probe(),
    status: completed,
    capabilities: capabilities(true),
    bundle,
    loading: false,
    mutation: null,
    error: null,
  };
  const completedDecision = deriveCollaborationSetupView(baseState);
  assert.equal(completedDecision.kind, 'health_pending');
  assert.equal(completedDecision.canRecover, true);

  const rolledBack = status(true);
  rolledBack.recoverable = false;
  rolledBack.journal = {
    ...rolledBack.journal!,
    status: 'rolled_back',
    operation: 'recover_rollback',
    restartRequired: true,
    healthPending: false,
  };
  const rolledBackDecision = deriveCollaborationSetupView({ ...baseState, status: rolledBack });
  assert.equal(rolledBackDecision.kind, 'health_pending');
  assert.equal(rolledBackDecision.canRecover, false);
});

test('health-pending rollback and rolled-back restart are both reachable through the store', async () => {
  let recovery: BootstrapRecoverParams | undefined;
  let restart: BootstrapRestartParams | undefined;
  const store = createCollaborationSetupStore(dependencies({
    healthPending: true,
    onRecover: (params) => { recovery = params; },
    onRestart: (params) => { restart = params; },
  }));
  await store.getState().refresh();
  await store.getState().recover('rollback');
  assert.deepEqual(recovery, {
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
    strategy: 'rollback',
  });

  const rolledBack = status(true);
  rolledBack.recoverable = false;
  rolledBack.journal = {
    ...rolledBack.journal!,
    status: 'rolled_back',
    operation: 'recover_rollback',
    restartRequired: true,
    healthPending: false,
  };
  store.setState({ status: rolledBack, restartAvailable: true });
  await store.getState().requestRestart();
  assert.deepEqual(restart, {
    operationId: 'operation-1',
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
  });
});

test('setup view refuses a loaded plugin with a different schema contract', () => {
  const decision = deriveCollaborationSetupView({
    identity: identity(),
    probe: probe(),
    status: status(false),
    capabilities: { ...capabilities(true), schemaVersion: bundle.schemaVersion - 1 },
    bundle,
    loading: false,
    mutation: null,
    error: null,
  });
  assert.equal(decision.kind, 'update');
  assert.equal(decision.canApply, true);
});

test('an orphaned journal can be explicitly archived from a different verified target', async () => {
  const orphanStatus = status(true);
  orphanStatus.recoveryRequired = true;
  orphanStatus.targetFingerprint = 'target-old';
  orphanStatus.journal = {
    ...orphanStatus.journal!,
    status: 'recovery_required',
    target: {
      ...orphanStatus.journal!.target,
      targetFingerprint: 'target-old',
      connectionId: 'connection-old',
    },
  };
  const currentIdentity = identity({ targetFingerprint: 'target-new', connectionId: 'connection-new' });
  const currentProbe = {
    ...probe(),
    targetFingerprint: 'target-new',
    connectionId: 'connection-new',
    recoveryRequired: true,
    mutationAllowed: false,
  };
  let abandoned: BootstrapAbandonParams | undefined;
  const store = createCollaborationSetupStore(dependencies({
    initialIdentity: currentIdentity,
    probeOverride: currentProbe,
    statusOverride: orphanStatus,
    onAbandon: (params) => { abandoned = params; },
  }));
  await store.getState().refresh();
  const decision = deriveCollaborationSetupView(store.getState());
  assert.equal(decision.kind, 'recovery');
  assert.equal(decision.canRecover, false);
  assert.equal(decision.canAbandon, true);

  await store.getState().abandonOrphan();
  assert.deepEqual(abandoned, {
    operationId: 'operation-1',
    orphanTargetFingerprint: 'target-old',
    currentTargetFingerprint: 'target-new',
    expectedConnectionId: 'connection-new',
  });
});

test('health confirmation requires a new connection with the exact bundle and durable feature contract', () => {
  const pending = status(true);
  const currentCapabilities = capabilities(true);
  const reconnected = identity({ connectionId: 'connection-2' });
  assert.deepEqual(
    createHealthConfirmation(pending, reconnected, currentCapabilities, bundle),
    {
      operationId: 'operation-1',
      targetFingerprint: 'target-1',
      expectedConnectionId: 'connection-2',
      collaborationInstanceId: 'instance-1',
      pluginVersion: bundle.pluginVersion,
      schemaVersion: bundle.schemaVersion,
      durableState: true,
      durableRuntime: true,
      durableRuntimeSupported: true,
      featureEvidenceKind: 'DECLARED_PLUGIN_CONTRACT',
      featureEvidenceBehaviorVerified: false,
      featureEvidenceRequiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
      featureEvidencePluginServiceStarted: true,
      featureEvidenceDatabaseIntegrity: 'ok',
      features: currentCapabilities.features,
    },
  );
  assert.equal(createHealthConfirmation(pending, identity(), currentCapabilities, bundle), null);
  assert.equal(
    createHealthConfirmation(
      pending,
      reconnected,
      { ...currentCapabilities, schemaVersion: bundle.schemaVersion - 1 },
      bundle,
    ),
    null,
  );
});
