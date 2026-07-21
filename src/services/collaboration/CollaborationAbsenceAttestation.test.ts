import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationBootstrapProbe } from '@/types/collaborationBootstrap';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  CollaborationAbsenceAttestation,
  CollaborationAbsenceAttestationError,
  CollaborationAbsenceAttestor,
  CollaborationAbsenceSpecification,
} from './CollaborationAbsenceAttestation';

function identity(overrides: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    runtimeId: null,
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
    methods: [],
    events: [],
    negotiatedRole: 'operator',
    negotiatedScopes: ['operator.read', 'operator.write'],
    supervisorLifecycle: 'running',
    supervisorPort: 18789,
    observedAtMs: 1,
    ...overrides,
  };
}

function probe(overrides: Partial<CollaborationBootstrapProbe> = {}): CollaborationBootstrapProbe {
  return {
    ok: true,
    code: 'PLUGIN_MISSING',
    message: 'The collaboration plugin and its durable state are absent',
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
    plugin: { installed: false, enabled: false },
    warnings: [],
    manualInstallInstructions: null,
    busy: false,
    recoveryRequired: false,
    durableCollaborationState: 'absent',
    ...overrides,
  };
}

test('absence attestation accepts only coherent JunQi-managed native, service, and Docker targets', () => {
  const scenarios = [
    {
      runtime: identity({
        deploymentKind: 'managed_child',
        persistence: 'desktop_bound',
        desktopExitContinuity: false,
      }),
      observation: probe({ targetClass: 'native_managed', deploymentKind: 'managed_child', durableRuntime: false }),
    },
    { runtime: identity(), observation: probe() },
    {
      runtime: identity({ deploymentKind: 'docker', installTarget: 'docker_exec' }),
      observation: probe({ targetClass: 'docker', deploymentKind: 'docker' }),
    },
  ];

  for (const scenario of scenarios) {
    const attestation = CollaborationAbsenceAttestation.from({
      before: scenario.runtime,
      after: scenario.runtime,
      probe: scenario.observation,
    });
    assert.equal(attestation.targetFingerprint, 'target-1');
    assert.equal(attestation.connectionId, 'connection-1');
    assert.equal(Object.isFrozen(attestation), true);
  }
});

test('absence specification rejects every non-absent durable state', () => {
  const specification = new CollaborationAbsenceSpecification();
  for (const state of ['present', 'corrupt', 'unknown'] as const) {
    const decision = specification.evaluate({
      before: identity(),
      after: identity(),
      probe: probe({ durableCollaborationState: state }),
    });
    assert.equal(decision.satisfied, false, state);
    assert.equal(decision.code, 'DURABLE_STATE_NOT_ABSENT', state);
  }
});

test('absence specification rejects warnings, busy recovery, and inconsistent plugin snapshots', () => {
  const specification = new CollaborationAbsenceSpecification();
  const ambiguous = [
    probe({ warnings: ['unexpected CLI output'] }),
    probe({ busy: true }),
    probe({ recoveryRequired: true }),
    probe({ manualInstallInstructions: 'install the plugin manually' }),
    probe({ plugin: { installed: false, enabled: true } }),
    probe({ plugin: { installed: false, enabled: false, status: 'disabled' } }),
    probe({ plugin: { installed: true, enabled: false } }),
  ];

  for (const observation of ambiguous) {
    assert.equal(specification.evaluate({
      before: identity(),
      after: identity(),
      probe: observation,
    }).satisfied, false);
  }
});

test('absence specification rejects external targets and any identity or path drift', () => {
  const specification = new CollaborationAbsenceSpecification();
  const external = identity({
    deploymentKind: 'external',
    ownership: 'remote',
    persistence: 'unknown',
    installTarget: 'remote_manual',
    endpointAttestation: 'not_applicable',
    pathAttestation: 'not_applicable',
    desktopMutationAllowed: false,
  });
  assert.equal(specification.evaluate({
    before: external,
    after: external,
    probe: probe({ targetClass: 'external_remote', deploymentKind: 'external', ownership: 'remote' }),
  }).satisfied, false);

  for (const after of [
    identity({ connectionId: 'connection-2' }),
    identity({ targetFingerprint: 'target-2' }),
    identity({ localStateDir: '/tmp/other' }),
    null,
  ]) {
    assert.equal(specification.evaluate({ before: identity(), after, probe: probe() }).satisfied, false);
  }
  assert.equal(specification.evaluate({
    before: identity(),
    after: identity(),
    probe: probe({ connectionId: 'connection-other' }),
  }).satisfied, false);
});

test('attestor passes the exact connection to Rust and rechecks identity after probing', async () => {
  const current = identity();
  const calls: Array<[string, string]> = [];
  const attestor = new CollaborationAbsenceAttestor({
    getRuntimeIdentity: () => current,
    probe: async (...args) => {
      calls.push(args);
      return probe();
    },
  });

  const attestation = await attestor.attest();
  assert.deepEqual(calls, [['target-1', 'connection-1']]);
  assert.equal(attestation.targetClass, 'system_service');
});

test('attestor fails closed when the connection changes during the probe', async () => {
  let current: RuntimeIdentity | null = identity();
  const attestor = new CollaborationAbsenceAttestor({
    getRuntimeIdentity: () => current,
    probe: async () => {
      current = identity({ connectionId: 'connection-2' });
      return probe();
    },
  });

  await assert.rejects(attestor.attest(), (error: unknown) => {
    assert.ok(error instanceof CollaborationAbsenceAttestationError);
    assert.equal(error.code, 'IDENTITY_CHANGED');
    return true;
  });
});

test('attestor re-probes durable state immediately before proof consumption', async () => {
  const current = identity();
  const observations = [probe(), probe({ durableCollaborationState: 'present' })];
  const attestor = new CollaborationAbsenceAttestor({
    getRuntimeIdentity: () => current,
    probe: async () => observations.shift() ?? probe(),
  });
  const proof = await attestor.attest();

  await assert.rejects(attestor.assertCurrent(proof), (error: unknown) => {
    assert.ok(error instanceof CollaborationAbsenceAttestationError);
    assert.equal(error.code, 'DURABLE_STATE_NOT_ABSENT');
    return true;
  });
});
