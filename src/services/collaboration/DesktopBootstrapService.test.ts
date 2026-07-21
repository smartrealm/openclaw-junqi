import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopBootstrapService, type DesktopBootstrapTransport } from './DesktopBootstrapService';
import type {
  BootstrapApplyParams,
  BootstrapAbandonParams,
  BootstrapConfigureParams,
  BootstrapConfirmHealthParams,
  BootstrapProbeParams,
  BootstrapRecoverParams,
  BootstrapRestartParams,
  CollaborationBootstrapConfigureResult,
  CollaborationBootstrapAbandonResult,
  CollaborationBootstrapProbe,
  CollaborationBootstrapRestartResult,
  CollaborationBootstrapResult,
  CollaborationBootstrapStatus,
} from '@/types/collaborationBootstrap';

const HEALTH_FEATURES = {
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
  WORKFLOW_TEMPLATES: true,
};

function result(): CollaborationBootstrapResult {
  return {
    ok: true,
    code: 'BOOTSTRAP_APPLIED',
    message: 'applied',
    operationId: 'operation-1',
    targetFingerprint: 'target-1',
    action: 'install',
    plugin: {
      installed: true,
      enabled: true,
      status: 'loaded',
      version: '0.1.0',
    },
    restartRequired: true,
    healthPending: true,
    recoverable: true,
    warnings: [],
  };
}

function restartResult(): CollaborationBootstrapRestartResult {
  return {
    ok: true,
    code: 'GATEWAY_RESTART_REQUESTED',
    message: 'restarted',
    operationId: 'operation-1',
    targetFingerprint: 'target-1',
    previousConnectionId: 'connection-1',
    targetClass: 'system_service',
    restartRequested: true,
    reconnectRequired: true,
    healthPending: true,
  };
}

function abandonResult(): CollaborationBootstrapAbandonResult {
  return {
    ok: true,
    code: 'BOOTSTRAP_ABANDONED',
    message: 'archived',
    operationId: 'operation-1',
    orphanTargetFingerprint: 'target-old',
    currentTargetFingerprint: 'target-1',
    evidenceRetained: true,
    applyUnblocked: true,
  };
}

function configureResult(): CollaborationBootstrapConfigureResult {
  return {
    ok: true,
    code: 'COLLABORATION_CONFIGURED',
    message: 'configured',
    targetFingerprint: 'target-1',
    connectionId: 'connection-1',
    coordinatorAgentId: 'coordinator',
    allowedAgentIds: ['coordinator', 'worker'],
    configuredAgentIds: ['coordinator', 'worker'],
    coordinatorPolicyUpdated: false,
    reloadExpected: true,
    warnings: [],
  };
}

test('DesktopBootstrapService binds probes to the exact target and connection', async () => {
  let received: BootstrapProbeParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async (params) => {
      received = params;
      return {} as CollaborationBootstrapProbe;
    },
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async () => result(),
    abandon: async () => abandonResult(),
    confirmHealth: async () => result(),
    restart: async () => restartResult(),
    configure: async () => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);

  await service.probe(' target-1 ', ' connection-1 ');
  assert.deepEqual(received, {
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
  });
  assert.throws(
    () => service.probe('target-1'),
    /must be provided together/,
  );
});

test('DesktopBootstrapService binds fixed-bundle apply to the exact target and connection', async () => {
  let received: BootstrapApplyParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async (_params?: BootstrapProbeParams) => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async (params) => {
      received = params;
      return result();
    },
    recover: async (_params: BootstrapRecoverParams) => result(),
    abandon: async (_params: BootstrapAbandonParams) => abandonResult(),
    confirmHealth: async (_params: BootstrapConfirmHealthParams) => result(),
    restart: async (_params: BootstrapRestartParams) => restartResult(),
    configure: async (_params: BootstrapConfigureParams) => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);
  const response = await service.apply({
    targetFingerprint: ' target-1 ',
    expectedConnectionId: ' connection-1 ',
  });

  assert.deepEqual(received, {
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
  });
  assert.equal(response.restartRequired, true);
  assert.equal(response.healthPending, true);
});

test('DesktopBootstrapService rejects an empty target before invoking Rust', async () => {
  let calls = 0;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => {
      calls += 1;
      return result();
    },
    recover: async () => result(),
    abandon: async () => abandonResult(),
    confirmHealth: async () => result(),
    restart: async () => restartResult(),
    configure: async () => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);

  assert.throws(
    () => service.apply({
      targetFingerprint: ' ',
      expectedConnectionId: 'connection-1',
    }),
    /targetFingerprint is required/,
  );
  assert.equal(calls, 0);
});

test('DesktopBootstrapService keeps recovery strategy explicit', async () => {
  let received: BootstrapRecoverParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async (params) => {
      received = params;
      return result();
    },
    abandon: async () => abandonResult(),
    confirmHealth: async () => result(),
    restart: async () => restartResult(),
    configure: async () => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);
  await service.recover({
    targetFingerprint: ' target-1 ',
    expectedConnectionId: ' connection-1 ',
    strategy: 'rollback',
  });
  assert.deepEqual(received, {
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
    strategy: 'rollback',
  });
});

test('DesktopBootstrapService fences orphan evidence archival to exact targets and connection', async () => {
  let received: BootstrapAbandonParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async () => result(),
    abandon: async (params) => {
      received = params;
      return abandonResult();
    },
    confirmHealth: async () => result(),
    restart: async () => restartResult(),
    configure: async () => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);
  await service.abandon({
    operationId: ' operation-1 ',
    orphanTargetFingerprint: ' target-old ',
    currentTargetFingerprint: ' target-1 ',
    expectedConnectionId: ' connection-1 ',
  });
  assert.deepEqual(received, {
    operationId: 'operation-1',
    orphanTargetFingerprint: 'target-old',
    currentTargetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
  });
});

test('DesktopBootstrapService confirms only the complete durable capability contract', async () => {
  let received: BootstrapConfirmHealthParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async () => result(),
    abandon: async () => abandonResult(),
    confirmHealth: async (params) => {
      received = params;
      return result();
    },
    restart: async () => restartResult(),
    configure: async () => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);
  await service.confirmHealth({
    operationId: ' operation-1 ',
    targetFingerprint: ' target-1 ',
    expectedConnectionId: ' connection-1 ',
    collaborationInstanceId: ' instance-1 ',
    pluginVersion: ' 0.1.0 ',
    schemaVersion: 1,
    durableState: true,
    durableRuntime: true,
    durableRuntimeSupported: true,
    featureEvidenceKind: 'DECLARED_PLUGIN_CONTRACT',
    featureEvidenceBehaviorVerified: false,
    featureEvidenceRequiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
    featureEvidencePluginServiceStarted: true,
    featureEvidenceDatabaseIntegrity: 'ok',
    features: HEALTH_FEATURES,
  });
  assert.deepEqual(received, {
    operationId: 'operation-1',
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
    collaborationInstanceId: 'instance-1',
    pluginVersion: '0.1.0',
    schemaVersion: 1,
    durableState: true,
    durableRuntime: true,
    durableRuntimeSupported: true,
    featureEvidenceKind: 'DECLARED_PLUGIN_CONTRACT',
    featureEvidenceBehaviorVerified: false,
    featureEvidenceRequiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
    featureEvidencePluginServiceStarted: true,
    featureEvidenceDatabaseIntegrity: 'ok',
    features: HEALTH_FEATURES,
  });
  assert.throws(
    () => service.confirmHealth({
      operationId: 'operation-1',
      targetFingerprint: 'target-1',
      expectedConnectionId: 'connection-1',
      collaborationInstanceId: 'instance-1',
      pluginVersion: '0.1.0',
      schemaVersion: 0,
      durableState: true,
      durableRuntime: true,
      durableRuntimeSupported: true,
      featureEvidenceKind: 'DECLARED_PLUGIN_CONTRACT',
      featureEvidenceBehaviorVerified: false,
      featureEvidenceRequiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
      featureEvidencePluginServiceStarted: true,
      featureEvidenceDatabaseIntegrity: 'ok',
      features: HEALTH_FEATURES,
    }),
    /positive integer/,
  );
});

test('DesktopBootstrapService binds restart to an exact operation and connection', async () => {
  let received: BootstrapRestartParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async () => result(),
    abandon: async () => abandonResult(),
    confirmHealth: async () => result(),
    restart: async (params) => {
      received = params;
      return restartResult();
    },
    configure: async () => configureResult(),
  };
  const service = new DesktopBootstrapService(transport);
  await service.restart({
    operationId: ' operation-1 ',
    targetFingerprint: ' target-1 ',
    expectedConnectionId: ' connection-1 ',
  });
  assert.deepEqual(received, {
    operationId: 'operation-1',
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
  });
});

test('DesktopBootstrapService normalizes an explicit collaboration Agent policy', async () => {
  let received: BootstrapConfigureParams | undefined;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async () => result(),
    abandon: async () => abandonResult(),
    confirmHealth: async () => result(),
    restart: async () => restartResult(),
    configure: async (params) => {
      received = params;
      return configureResult();
    },
  };
  const service = new DesktopBootstrapService(transport);
  await service.configure({
    targetFingerprint: ' target-1 ',
    expectedConnectionId: ' connection-1 ',
    coordinatorAgentId: ' Coordinator ',
    allowedAgentIds: [' Coordinator ', 'Worker One'],
  });
  assert.deepEqual(received, {
    targetFingerprint: 'target-1',
    expectedConnectionId: 'connection-1',
    coordinatorAgentId: 'coordinator',
    allowedAgentIds: ['coordinator', 'worker-one'],
  });
});

test('DesktopBootstrapService rejects wildcard, duplicate, and coordinator-omitting policies', () => {
  let calls = 0;
  const transport: DesktopBootstrapTransport = {
    probe: async () => ({}) as CollaborationBootstrapProbe,
    status: async () => ({}) as CollaborationBootstrapStatus,
    apply: async () => result(),
    recover: async () => result(),
    abandon: async () => abandonResult(),
    confirmHealth: async () => result(),
    restart: async () => restartResult(),
    configure: async () => {
      calls += 1;
      return configureResult();
    },
  };
  const service = new DesktopBootstrapService(transport);
  assert.throws(
    () => service.configure({
      targetFingerprint: 'target-1',
      expectedConnectionId: 'connection-1',
      coordinatorAgentId: 'coordinator',
      allowedAgentIds: ['*'],
    }),
    /explicit agent id/,
  );
  assert.throws(
    () => service.configure({
      targetFingerprint: 'target-1',
      expectedConnectionId: 'connection-1',
      coordinatorAgentId: 'coordinator',
      allowedAgentIds: ['worker one', 'worker-one'],
    }),
    /duplicate normalized/,
  );
  assert.throws(
    () => service.configure({
      targetFingerprint: 'target-1',
      expectedConnectionId: 'connection-1',
      coordinatorAgentId: 'coordinator',
      allowedAgentIds: ['worker'],
    }),
    /include coordinatorAgentId/,
  );
  assert.equal(calls, 0);
});
