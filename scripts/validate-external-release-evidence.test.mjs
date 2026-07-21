import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  EXTERNAL_RELEASE_POLICY_VERSION,
  EXTERNAL_RELEASE_TEST_PLAN_SHA256,
  MAX_FD_GROWTH,
  MIN_SOAK_DURATION_MS,
  P014_NEGATIVE_PROBE_REQUIREMENTS,
  P014_PROOF_SCHEMA_VERSION,
  P014_TRACE_ARTIFACT_KIND,
  P014_TRACE_EVENT_COUNT,
  P014_TRACE_SCHEMA_VERSION,
  REQUIRED_P0_CASE_IDS,
  REQUIRED_P014_NEGATIVE_PROBE_IDS,
  REQUIRED_SOAK_FAULT_IDS,
  REQUIRED_SOAK_INVARIANT_IDS,
  REQUIRED_VISUAL_ASSERTIONS,
  REQUIRED_VISUAL_SCENARIOS,
  REQUIRED_VISUAL_VIEWPORTS,
  SOAK_HEARTBEAT_INTERVAL_MS,
  TRUSTED_EVIDENCE_WORKFLOWS,
  assessExternalReleaseEvidence,
  parseArguments,
  parseStrictJson,
  verifyPhysicalArtifactRoot,
  verifyVisualCandidateAgainstReleaseAssets,
} from './validate-external-release-evidence.mjs';
import {
  OFFICIAL_OPENCLAW_IMAGE_DIGEST,
  OFFICIAL_OPENCLAW_VERSION,
} from './verify-collaboration-real-gateway.mjs';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BUNDLE = 'a'.repeat(64);
const ARTIFACT = 'b'.repeat(64);
const VISUAL_CANDIDATE_NAME = 'junqi-desktop-windows-x64.exe';
const RELEASE_REF = 'refs/tags/v0.5.4';
const RUN_IDS = Object.freeze({ gateway: '101', visual: '102', soak: '103' });
const PRODUCERS = Object.freeze({
  gateway: Object.freeze({ runId: RUN_IDS.gateway, runAttempt: 1 }),
  visual: Object.freeze({ runId: RUN_IDS.visual, runAttempt: 1 }),
  soak: Object.freeze({ runId: RUN_IDS.soak, runAttempt: 1 }),
});

test('external policy requires the complete P0-01 through P0-14 Gateway set', () => {
  assert.equal(EXTERNAL_RELEASE_POLICY_VERSION, 7);
  assert.equal(P014_PROOF_SCHEMA_VERSION, 3);
  assert.equal(P014_TRACE_SCHEMA_VERSION, 1);
  assert.equal(P014_TRACE_EVENT_COUNT, 24);
  assert.equal(REQUIRED_P0_CASE_IDS.length, 14);
  assert.equal(REQUIRED_P0_CASE_IDS[0], 'P0-01');
  assert.equal(REQUIRED_P0_CASE_IDS.at(-1), 'P0-14');
  assert.deepEqual(
    Object.keys(P014_NEGATIVE_PROBE_REQUIREMENTS),
    REQUIRED_P014_NEGATIVE_PROBE_IDS,
  );
});

test('external release CLI requires an immutable source SHA', () => {
  const values = {
    quality: 'quality.json',
    gateway: 'gateway.json',
    'gateway-artifact-root': 'gateway',
    visual: 'visual.json',
    'visual-artifact-root': 'visual',
    soak: 'soak.json',
    'soak-artifact-root': 'soak',
    'gateway-run-id': '101',
    'gateway-run-attempt': '1',
    'visual-run-id': '102',
    'visual-run-attempt': '1',
    'soak-run-id': '103',
    'soak-run-attempt': '1',
    'release-asset-root': 'assets',
    'release-ref': RELEASE_REF,
    'source-sha': COMMIT,
  };
  const argv = Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
  assert.equal(parseArguments(argv)['source-sha'], COMMIT);
  assert.throws(
    () => parseArguments(argv.filter((_, index) => index < argv.length - 2)),
    (error) => error?.code === 'INVALID_ARGUMENT',
  );
});

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function artifact(kind, suffix = kind.toLowerCase()) {
  return { kind, name: `${suffix}.json`, sha256: ARTIFACT, bytes: 128 };
}

function p014TraceClaims(proof) {
  return {
    schemaVersion: proof.schemaVersion,
    target: proof.target,
    capabilitiesProbe: proof.capabilitiesProbe,
    absenceProbe: proof.absenceProbe,
    mutations: proof.mutations,
    maintenance: proof.maintenance,
    negativeProbes: proof.negativeProbes,
  };
}

function p014TraceEvents(proof) {
  const stateEvent = (type, role, sequence, probe) => ({
    type,
    role,
    sequence,
    targetFingerprint: probe.targetFingerprint,
    connectionId: probe.connectionId,
    state: {
      pluginSnapshot: probe.pluginSnapshot,
      durableState: probe.durableState,
    },
    passed: probe.passed,
  });
  const coreEvent = (effect) => ({
    type: 'CORE_RPC_EFFECT',
    sequence: effect.sequence,
    method: effect.method,
    targetFingerprint: effect.targetFingerprint,
    connectionId: effect.connectionId,
    requestedKey: effect.requestedKey,
    response: effect.response,
  });
  const events = [
    {
      type: 'TARGET_ATTESTED',
      targetFingerprint: proof.target.targetFingerprint,
      connectionId: proof.target.connectionId,
      deploymentKind: proof.target.deploymentKind,
      pluginSnapshot: proof.target.pluginSnapshot,
      durableState: proof.target.durableState,
    },
    {
      type: 'CAPABILITIES_PROBE',
      sequence: proof.capabilitiesProbe.sequence,
      targetFingerprint: proof.capabilitiesProbe.targetFingerprint,
      connectionId: proof.capabilitiesProbe.connectionId,
      method: proof.capabilitiesProbe.method,
      error: proof.capabilitiesProbe.error,
      passed: proof.capabilitiesProbe.passed,
    },
    stateEvent('STATE_PROBE', 'INITIAL_ABSENCE', proof.absenceProbe.sequence, proof.absenceProbe),
    stateEvent('STATE_PROBE', 'RESET_USE_POINT', proof.mutations.reset.usePointProbe.sequence, proof.mutations.reset.usePointProbe),
    coreEvent(proof.mutations.reset),
    stateEvent('STATE_PROBE', 'DELETE_USE_POINT', proof.mutations.delete.usePointProbe.sequence, proof.mutations.delete.usePointProbe),
    coreEvent(proof.mutations.delete),
    stateEvent('STATE_PROBE', 'MAINTENANCE_USE_POINT', proof.maintenance.usePointProbe.sequence, proof.maintenance.usePointProbe),
    {
      type: 'MAINTENANCE_EFFECT',
      sequence: proof.maintenance.sequence,
      targetFingerprint: proof.maintenance.targetFingerprint,
      connectionId: proof.maintenance.connectionId,
      callback: proof.maintenance.callback,
    },
  ];
  for (const probe of proof.negativeProbes) {
    events.push(
      {
        type: 'NEGATIVE_BASELINE',
        id: probe.id,
        fixtureId: probe.fixtureId,
        sequence: probe.expected.sequence,
        identity: probe.expected.identity,
        state: probe.expected.state,
      },
      {
        type: 'NEGATIVE_OBSERVED',
        id: probe.id,
        fixtureId: probe.fixtureId,
        sequence: probe.observed.sequence,
        identity: probe.observed.identity,
        state: probe.observed.state,
      },
      {
        type: 'NEGATIVE_DECISION',
        id: probe.id,
        fixtureId: probe.fixtureId,
        identityMatch: probe.identityMatch,
        rejected: probe.rejected,
        rejectionCode: probe.rejectionCode,
        decisionSequence: probe.decisionSequence,
      },
    );
  }
  return events.map((event, index) => ({ ordinal: index + 1, ...event }));
}

function p014TraceBytes(
  proof,
  workflowRunId = RUN_IDS.gateway,
  workflowRunAttempt = PRODUCERS.gateway.runAttempt,
) {
  const events = p014TraceEvents(proof);
  const claimsSha256 = digest(Buffer.from(stableJson(p014TraceClaims(proof))));
  const eventsSha256 = digest(Buffer.from(stableJson(events)));
  const document = {
    schemaVersion: P014_TRACE_SCHEMA_VERSION,
    kind: 'P014_EXECUTION_TRACE',
    workflowRunId,
    workflowRunAttempt,
    caseId: 'P0-14',
    eventsSha256,
    claimsSha256,
    events,
  };
  return Buffer.from(`${stableJson(document)}\n`);
}

function p014TraceMetadata(
  proof,
  workflowRunId = RUN_IDS.gateway,
  workflowRunAttempt = PRODUCERS.gateway.runAttempt,
) {
  const bytes = p014TraceBytes(proof, workflowRunId, workflowRunAttempt);
  const events = p014TraceEvents(proof);
  return {
    kind: P014_TRACE_ARTIFACT_KIND,
    name: 'p0-14-execution-trace.json',
    sha256: digest(bytes),
    bytes: bytes.length,
    eventsSha256: digest(Buffer.from(stableJson(events))),
    claimsSha256: digest(Buffer.from(stableJson(p014TraceClaims(proof)))),
  };
}

function quality() {
  return {
    schemaVersion: 1,
    evidenceType: 'AUTOMATED_QUALITY',
    repo: 'smartrealm/openclaw-junqi',
    source: { commit: COMMIT, tree: TREE },
    desktop: { name: 'junqi-desktop', version: '0.5.4' },
    plugin: {
      id: 'junqi-collab',
      packageName: '@junqi/openclaw-collaboration',
      version: '0.2.0',
      schemaVersion: 10,
    },
    sha256: {
      bundle: BUNDLE,
      metadata: { resource: 'c'.repeat(64), generated: 'c'.repeat(64) },
      lockfiles: { pnpm: 'd'.repeat(64), cargo: 'e'.repeat(64) },
    },
    toolchain: { node: 'v22.23.1', pnpm: '9.15.9', rustc: 'rustc 1.88.0', cargo: 'cargo 1.88.0' },
    workflow: { runId: '90', runAttempt: 1, prerequisiteJobs: ['quality-node', 'quality-rust'] },
    externalAcceptance: 'NOT_EVALUATED',
  };
}

function base(evidenceType, options = {}) {
  const kind = evidenceType.toLowerCase();
  const startedAt = options.startedAt ?? NOW - 3 * HOUR;
  const completedAt = options.completedAt ?? NOW - 2 * HOUR;
  return {
    schemaVersion: 1,
    evidenceType,
    repo: 'smartrealm/openclaw-junqi',
    source: { commit: COMMIT, tree: TREE },
    bundleSha256: BUNDLE,
    plugin: { id: 'junqi-collab', version: '0.2.0', schemaVersion: 10 },
    policy: {
      version: EXTERNAL_RELEASE_POLICY_VERSION,
      testPlanSha256: EXTERNAL_RELEASE_TEST_PLAN_SHA256,
    },
    workflow: {
      repo: 'smartrealm/openclaw-junqi',
      path: TRUSTED_EVIDENCE_WORKFLOWS[evidenceType],
      ref: RELEASE_REF,
      runId: PRODUCERS[kind].runId,
      runAttempt: PRODUCERS[kind].runAttempt,
    },
    startedAt: iso(startedAt),
    completedAt: iso(completedAt),
    issuedAt: iso(completedAt + 30 * 60 * 1000),
    expiresAt: iso(completedAt + 6 * HOUR),
  };
}

function p014StateProbe(sequence) {
  return {
    sequence,
    targetFingerprint: 'target-p014',
    connectionId: 'connection-p014',
    pluginSnapshot: 'MISSING',
    durableState: 'ABSENT',
    coreRpcCalls: 0,
    effectCalls: 0,
    passed: true,
  };
}

function p014Mutation(method, sequence, probeSequence, requestedKey, response) {
  return {
    sequence,
    method,
    targetFingerprint: 'target-p014',
    connectionId: 'connection-p014',
    requestedKey,
    response,
    usePointProbe: p014StateProbe(probeSequence),
    coreRpcCalls: 1,
    effectCalls: 1,
  };
}

function p014NegativeProbe(id, index) {
  const requirement = P014_NEGATIVE_PROBE_REQUIREMENTS[id];
  const expectedIdentity = {
    targetFingerprint: `target-p014-fixture-${index}`,
    connectionId: `connection-p014-fixture-${index}`,
  };
  const observedIdentity = requirement.identityMatch
    ? { ...expectedIdentity }
    : {
        targetFingerprint: `target-p014-fixture-${index}-observed`,
        connectionId: `connection-p014-fixture-${index}-observed`,
      };
  return {
    id,
    fixtureId: `p014-negative-fixture-${index}`,
    expected: {
      sequence: 1,
      identity: expectedIdentity,
      state: { pluginSnapshot: 'MISSING', durableState: 'ABSENT' },
    },
    observed: {
      sequence: 2,
      identity: observedIdentity,
      state: {
        pluginSnapshot: requirement.observedPluginSnapshot,
        durableState: requirement.observedDurableState,
      },
    },
    identityMatch: requirement.identityMatch,
    rejected: true,
    rejectionCode: requirement.rejectionCode,
    decisionSequence: 3,
    coreRpcCalls: 0,
    effectCalls: 0,
  };
}

function p014Proof() {
  const negativeProbes = REQUIRED_P014_NEGATIVE_PROBE_IDS.map(p014NegativeProbe);
  assert.deepEqual(negativeProbes.map((probe) => probe.id), REQUIRED_P014_NEGATIVE_PROBE_IDS);
  const proof = {
    schemaVersion: P014_PROOF_SCHEMA_VERSION,
    target: {
      targetFingerprint: 'target-p014',
      connectionId: 'connection-p014',
      deploymentKind: 'EPHEMERAL_CONTAINER',
      pluginSnapshot: 'MISSING',
      durableState: 'ABSENT',
    },
    capabilitiesProbe: {
      sequence: 1,
      targetFingerprint: 'target-p014',
      connectionId: 'connection-p014',
      method: 'junqi.collab.capabilities',
      error: { code: 'INVALID_REQUEST', classification: 'METHOD_NOT_FOUND', exact: true },
      coreRpcCalls: 1,
      effectCalls: 0,
      passed: true,
    },
    absenceProbe: p014StateProbe(2),
    mutations: {
      reset: p014Mutation('sessions.reset', 4, 3, 'agent-main-reset', { ok: true, key: 'agent-main-reset' }),
      delete: p014Mutation('sessions.delete', 6, 5, 'agent-main-delete', { ok: true, key: 'agent-main-delete', deleted: true }),
    },
    maintenance: {
      sequence: 8,
      targetFingerprint: 'target-p014',
      connectionId: 'connection-p014',
      usePointProbe: p014StateProbe(7),
      callback: { executed: true, invocationCount: 1, guarded: false },
      coreRpcCalls: 0,
      effectCalls: 1,
    },
    negativeProbes,
  };
  return { ...proof, traceArtifact: p014TraceMetadata(proof) };
}

function gateway() {
  const evidence = base('GATEWAY');
  const startedAt = Date.parse(evidence.startedAt);
  return {
    ...evidence,
    scope: 'FULL_BEHAVIORAL',
    p0BehaviorVerified: true,
    capabilitiesOnly: false,
    structuralOnly: false,
    runtime: {
      openclawVersion: OFFICIAL_OPENCLAW_VERSION,
      imageDigest: OFFICIAL_OPENCLAW_IMAGE_DIGEST,
      environmentKind: 'EPHEMERAL_CONTAINER',
      devMode: false,
      defaultProfileMounted: false,
      disposable: true,
      isolation: { home: true, xdgConfig: true, xdgCache: true, xdgData: true, xdgState: true, tmp: true },
    },
    cases: REQUIRED_P0_CASE_IDS.map((id, index) => {
      const proof = id === 'P0-14' ? p014Proof() : undefined;
      const traceArtifact = proof?.traceArtifact;
      return {
        id,
        status: 'PASS',
        startedAt: iso(startedAt + index * 2_000),
        endedAt: iso(startedAt + index * 2_000 + 1_000),
        identities: {
          rpcMethods: [`collaboration.${id.toLowerCase()}`],
          taskIds: [`task-${id.toLowerCase()}`],
          agentRunIds: [],
          sessionIds: [],
          messageIds: [],
          flowIds: [],
        },
        artifacts: [
          artifact('OBSERVATION', id.toLowerCase()),
          ...(traceArtifact ? [{
            kind: traceArtifact.kind,
            name: traceArtifact.name,
            sha256: traceArtifact.sha256,
            bytes: traceArtifact.bytes,
          }] : []),
        ],
        ...(proof ? { p014: proof } : {}),
      };
    }),
  };
}

function visual() {
  const evidence = base('VISUAL');
  const startedAt = Date.parse(evidence.startedAt);
  return {
    ...evidence,
    candidate: {
      desktopVersion: '0.5.4',
      platform: 'WINDOWS',
      artifactName: VISUAL_CANDIDATE_NAME,
      artifactSha256: ARTIFACT,
    },
    environment: {
      browserName: 'chromium',
      browserVersion: '140.0.0',
      osName: 'Windows',
      osVersion: '11',
    },
    observations: REQUIRED_VISUAL_SCENARIOS.flatMap((scenarioId, scenarioIndex) => (
      REQUIRED_VISUAL_VIEWPORTS.map((viewport, viewportIndex) => {
        const offset = (scenarioIndex * REQUIRED_VISUAL_VIEWPORTS.length + viewportIndex) * 2_000;
        return {
          scenarioId,
          viewport: { ...viewport, deviceScaleFactor: 1 },
          status: 'PASS',
          startedAt: iso(startedAt + offset),
          endedAt: iso(startedAt + offset + 1_000),
          assertions: REQUIRED_VISUAL_ASSERTIONS[scenarioId].map((id) => ({ id, status: 'PASS' })),
          artifacts: [
            artifact('SCREENSHOT', `${scenarioId}-${viewport.id}`),
            artifact('INTERACTION_TRACE', `${scenarioId}-${viewport.id}-trace`),
            ...(scenarioIndex === 0 && viewportIndex === 0
              ? [{ kind: 'CANDIDATE_INSTALLER', name: VISUAL_CANDIDATE_NAME, sha256: ARTIFACT, bytes: 128 }]
              : []),
          ],
          consoleErrors: [],
          pageErrors: [],
          failedRequests: [],
        };
      })
    )),
  };
}

function soak() {
  const wallStartedAt = NOW - 26 * HOUR;
  const evidence = base('SOAK', { startedAt: wallStartedAt, completedAt: NOW - 2 * HOUR });
  const startedMs = 10_000;
  const endedMs = startedMs + MIN_SOAK_DURATION_MS;
  const heartbeats = [];
  for (let current = startedMs; current <= endedMs; current += SOAK_HEARTBEAT_INTERVAL_MS) {
    heartbeats.push(current);
  }
  return {
    ...evidence,
    seed: 'release-seed-20260717',
    heartbeatIntervalMs: SOAK_HEARTBEAT_INTERVAL_MS,
    heartbeats,
    clock: { source: 'MONOTONIC', startedMs, endedMs, durationMs: MIN_SOAK_DURATION_MS },
    faults: REQUIRED_SOAK_FAULT_IDS.map((id, index) => {
      const injectedAtMs = startedMs + (index + 1) * HOUR;
      return {
        id,
        status: 'PASS',
        plannedInjections: 1,
        events: [{
          sequence: 1,
          status: 'PASS',
          injectedAtMs,
          recoveredAtMs: injectedAtMs + 60_000,
          artifacts: [artifact('OBSERVATION', id)],
        }],
      };
    }),
    finalInvariants: REQUIRED_SOAK_INVARIANT_IDS.map((id) => ({
      id,
      status: 'PASS',
      observed: id === 'database-integrity'
        ? { value: 'ok' }
        : id === 'bounded-resource-growth'
          ? { rssGrowthBytes: 0, fdGrowth: 0 }
          : { count: 0 },
      artifactSha256: ARTIFACT,
    })),
    artifacts: [artifact('LOG', 'soak-log'), artifact('METRICS', 'soak-metrics')],
  };
}

function input() {
  return {
    quality: quality(),
    gateway: gateway(),
    visual: visual(),
    soak: soak(),
    producers: structuredClone(PRODUCERS),
    releaseRef: RELEASE_REF,
    nowMs: NOW,
  };
}

function blocked(mutator, expectedCode) {
  const value = input();
  mutator(value);
  const decision = assessExternalReleaseEvidence(value);
  assert.equal(decision.kind, 'BLOCKED', JSON.stringify(decision));
  if (expectedCode) assert.equal(decision.code, expectedCode, JSON.stringify(decision));
  return decision;
}

describe('external release evidence policy', () => {
  test('accepts only the complete subject-bound release evidence set', () => {
    const decision = assessExternalReleaseEvidence(input());
    assert.equal(decision.kind, 'SATISFIED', JSON.stringify(decision));
    assert.equal(decision.policyVersion, EXTERNAL_RELEASE_POLICY_VERSION);
    assert.equal(decision.testPlanSha256, EXTERNAL_RELEASE_TEST_PLAN_SHA256);
    assert.equal(decision.releaseRef, RELEASE_REF);
    assert.deepEqual(decision.workflowRuns, PRODUCERS);
    assert.equal(decision.subject.bundleSha256, BUNDLE);
    assert.equal(decision.visualCandidate.artifactName, VISUAL_CANDIDATE_NAME);
    assert.equal(decision.artifactReferences.gateway.length, REQUIRED_P0_CASE_IDS.length + 1);
    assert.equal(
      decision.artifactReferences.gateway.filter((entry) => entry.kind === P014_TRACE_ARTIFACT_KIND).length,
      1,
    );
    assert.ok(decision.artifactReferences.visual.some((entry) => entry.kind === 'CANDIDATE_INSTALLER'));
  });

  test('rejects subject, policy, producer, tag, and run mismatches', () => {
    blocked((value) => { value.gateway.repo = 'another/repository'; }, 'SUBJECT_MISMATCH');
    blocked((value) => { value.visual.source.tree = '3'.repeat(40); }, 'SUBJECT_MISMATCH');
    blocked((value) => { value.soak.bundleSha256 = 'f'.repeat(64); }, 'SUBJECT_MISMATCH');
    blocked((value) => { value.gateway.plugin.schemaVersion = 11; }, 'SUBJECT_MISMATCH');
    blocked((value) => { value.visual.policy.testPlanSha256 = 'f'.repeat(64); }, 'POLICY_MISMATCH');
    blocked((value) => { value.gateway.workflow.path = TRUSTED_EVIDENCE_WORKFLOWS.VISUAL; }, 'PRODUCER_MISMATCH');
    blocked((value) => { value.visual.workflow.ref = 'refs/tags/v0.5.3'; }, 'PRODUCER_MISMATCH');
    blocked((value) => { value.soak.workflow.runAttempt = 2; }, 'RUN_MISMATCH');
    blocked((value) => { value.producers.soak.runId = value.producers.gateway.runId; }, 'DUPLICATE_RUN');
    blocked((value) => { value.releaseRef = 'refs/heads/main'; }, 'INVALID_VALUE');
  });

  test('requires every behavioral P0 case exactly once with observations', () => {
    blocked((value) => { value.gateway.cases.pop(); }, 'MISSING_ENTRY');
    blocked((value) => { value.gateway.cases[1].id = value.gateway.cases[0].id; }, 'DUPLICATE_ENTRY');
    blocked((value) => { value.gateway.cases[0].status = 'FAIL'; }, 'NOT_PASSED');
    blocked((value) => { value.gateway.cases[0].skipped = false; }, 'SKIP_FORBIDDEN');
    blocked((value) => { value.gateway.cases[0].identities.rpcMethods = []; value.gateway.cases[0].identities.taskIds = []; }, 'MISSING_OBSERVATION');
    blocked((value) => { value.gateway.cases[0].artifacts = []; }, 'MISSING_ARTIFACT');
    blocked((value) => { value.gateway.scope = 'STRUCTURAL_ONLY'; }, 'SCOPE_MISMATCH');
    blocked((value) => { value.gateway.p0BehaviorVerified = false; }, 'SCOPE_MISMATCH');
  });

  test('requires the P0-14 no-plugin absence, mutation, maintenance, and negative-proof contract', () => {
    const p014 = (value) => value.gateway.cases.at(-1).p014;
    blocked((value) => { delete value.gateway.cases.at(-1).p014; }, 'MISSING_FIELD');
    blocked((value) => { p014(value).target.durableState = 'PRESENT'; }, 'P014_STATE_MISMATCH');
    blocked((value) => { p014(value).mutations.reset.response.key = 'agent-other'; }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => { p014(value).mutations.reset.usePointProbe.connectionId = 'connection-other'; }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => { p014(value).maintenance.callback.guarded = true; }, 'P014_MAINTENANCE_GUARDED');
    blocked((value) => { p014(value).maintenance.callback.invocationCount = 2; }, 'P014_MAINTENANCE_FAILED');
    blocked((value) => { p014(value).capabilitiesProbe.error.classification = 'UNKNOWN'; }, 'P014_CAPABILITIES_CLASSIFICATION');
    blocked((value) => { p014(value).mutations.delete.usePointProbe.sequence = 6; }, 'P014_SEQUENCE_MISMATCH');
    blocked((value) => {
      p014(value).negativeProbes.find((probe) => probe.id === 'plugin-present').coreRpcCalls = 1;
    }, 'P014_CORE_RPC_FORBIDDEN');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'identity-mismatch');
      const other = p014(value).negativeProbes.find((entry) => entry.id === 'unknown');
      probe.observed.identity = { ...other.expected.identity };
    }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'identity-mismatch');
      probe.identityMatch = true;
    }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'plugin-present');
      probe.identityMatch = false;
    }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'plugin-present');
      probe.observed.state.pluginSnapshot = 'MISSING';
    }, 'P014_STATE_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'corrupt');
      probe.expected.state.durableState = 'PRESENT';
    }, 'P014_STATE_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'unknown');
      probe.rejectionCode = 'PLUGIN_NOT_PROVEN_MISSING';
    }, 'P014_REJECTION_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'durable-present');
      probe.rejected = false;
    }, 'P014_REJECTION_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'durable-present');
      probe.decisionSequence = probe.observed.sequence;
    }, 'P014_SEQUENCE_MISMATCH');
    blocked((value) => {
      const probes = p014(value).negativeProbes;
      probes[1].fixtureId = probes[0].fixtureId;
    }, 'DUPLICATE_ENTRY');
    blocked((value) => {
      const probes = p014(value).negativeProbes;
      probes[1].expected.identity = { ...probes[0].expected.identity };
      probes[1].observed.identity = { ...probes[0].observed.identity };
    }, 'DUPLICATE_ENTRY');
    blocked((value) => {
      const probes = p014(value).negativeProbes;
      probes[1].expected.identity.targetFingerprint = probes[0].expected.identity.targetFingerprint;
      probes[1].observed.identity.targetFingerprint = probes[0].observed.identity.targetFingerprint;
    }, 'DUPLICATE_ENTRY');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'plugin-present');
      probe.expected.identity = {
        targetFingerprint: p014(value).target.targetFingerprint,
        connectionId: p014(value).target.connectionId,
      };
      probe.observed.identity = { ...probe.expected.identity };
    }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'plugin-present');
      probe.expected.identity.targetFingerprint = p014(value).target.targetFingerprint;
      probe.observed.identity.targetFingerprint = p014(value).target.targetFingerprint;
    }, 'P014_IDENTITY_MISMATCH');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'plugin-present');
      probe.fixtureId = '/tmp/p014-fixture';
    }, 'UNSAFE_P014_VALUE');
    blocked((value) => {
      const probe = p014(value).negativeProbes.find((entry) => entry.id === 'plugin-present');
      probe.untrusted = true;
    }, 'UNKNOWN_FIELD');
    blocked((value) => { p014(value).target.targetFingerprint = '/tmp/target'; }, 'UNSAFE_P014_VALUE');
    blocked((value) => { p014(value).target.connectionId = 'Bearer super-secret-token'; }, 'SECRET_IN_EVIDENCE');
    blocked((value) => { delete p014(value).traceArtifact; }, 'MISSING_FIELD');
    blocked((value) => { p014(value).traceArtifact.kind = 'OBSERVATION'; }, 'P014_TRACE_ARTIFACT_MISMATCH');
    blocked((value) => { p014(value).traceArtifact.claimsSha256 = 'f'.repeat(64); }, 'P014_TRACE_BINDING_MISMATCH');
    blocked((value) => {
      const proof = p014(value);
      proof.mutations.reset.requestedKey = 'agent-main-reset-rebound';
      proof.mutations.reset.response.key = 'agent-main-reset-rebound';
    }, 'P014_TRACE_BINDING_MISMATCH');
    blocked((value) => {
      value.gateway.cases.at(-1).artifacts = value.gateway.cases.at(-1).artifacts
        .filter((entry) => entry.kind !== P014_TRACE_ARTIFACT_KIND);
    }, 'MISSING_ARTIFACT');
    blocked((value) => {
      value.gateway.cases[0].artifacts.push(artifact(P014_TRACE_ARTIFACT_KIND, 'p0-01-forged-trace'));
    }, 'P014_TRACE_ARTIFACT_MISMATCH');
    blocked((value) => { value.gateway.cases[0].p014 = p014Proof(); }, 'UNKNOWN_FIELD');
  });

  test('requires pinned disposable and isolated Gateway runtime', () => {
    blocked((value) => { value.gateway.runtime.imageDigest = 'sha256:' + '0'.repeat(64); }, 'RUNTIME_MISMATCH');
    blocked((value) => { value.gateway.runtime.defaultProfileMounted = true; }, 'ISOLATION_MISMATCH');
    blocked((value) => { value.gateway.runtime.isolation.home = false; }, 'ISOLATION_MISMATCH');
  });

  test('requires the full visual candidate, browser, assertion, and viewport contract', () => {
    blocked((value) => { value.visual.observations.pop(); }, 'MISSING_ENTRY');
    blocked((value) => {
      value.visual.observations[1].scenarioId = value.visual.observations[0].scenarioId;
      value.visual.observations[1].viewport = { ...value.visual.observations[0].viewport };
    }, 'DUPLICATE_ENTRY');
    blocked((value) => { value.visual.candidate.desktopVersion = '0.5.3'; }, 'SUBJECT_MISMATCH');
    blocked((value) => { value.visual.candidate.platform = 'LINUX'; }, 'INVALID_VALUE');
    blocked((value) => { value.visual.candidate.artifactSha256 = 'f'.repeat(64); }, 'SUBJECT_MISMATCH');
    blocked((value) => { value.visual.environment.browserVersion = ''; }, 'INVALID_VALUE');
    blocked((value) => { value.visual.observations[0].viewport.width = 1280; }, 'VIEWPORT_MISMATCH');
    blocked((value) => { value.visual.observations[0].assertions[0].status = 'FAIL'; }, 'NOT_PASSED');
    blocked((value) => { value.visual.observations[0].artifacts.pop(); }, 'MISSING_ARTIFACT');
    blocked((value) => { value.visual.observations[0].consoleErrors.push('render failed'); }, 'BROWSER_ERROR');
  });

  test('requires safe globally unique artifact paths within each evidence type', () => {
    for (const unsafeName of ['/absolute.json', '../escape.json', 'nested/../escape.json', 'nested\\escape.json', 'nested//escape.json']) {
      blocked((value) => { value.gateway.cases[0].artifacts[0].name = unsafeName; }, 'UNSAFE_ARTIFACT_PATH');
    }
    blocked((value) => {
      value.visual.observations[1].artifacts[0].name = value.visual.observations[0].artifacts[0].name;
    }, 'DUPLICATE_ARTIFACT_REFERENCE');
  });

  test('requires monotonic soak heartbeats, per-fault recovery, and final invariants', () => {
    blocked((value) => { value.soak.clock.durationMs -= 1; }, 'INVALID_DURATION');
    blocked((value) => {
      value.soak.clock.endedMs = value.soak.clock.startedMs + MIN_SOAK_DURATION_MS - 1;
      value.soak.clock.durationMs = MIN_SOAK_DURATION_MS - 1;
    }, 'SOAK_TOO_SHORT');
    blocked((value) => { value.soak.heartbeats[0] = value.soak.clock.startedMs - 1; }, 'HEARTBEAT_MISMATCH');
    blocked((value) => { value.soak.heartbeats.splice(2, 2); }, 'HEARTBEAT_MISSING');
    blocked((value) => { value.soak.faults.pop(); }, 'MISSING_ENTRY');
    blocked((value) => { value.soak.faults[0].events = []; }, 'MISSING_ENTRY');
    blocked((value) => { value.soak.faults[0].events[0].recoveredAtMs = value.soak.clock.endedMs + 1; }, 'INVALID_DURATION');
    blocked((value) => { value.soak.finalInvariants.pop(); }, 'MISSING_ENTRY');
    blocked((value) => { value.soak.finalInvariants[0].artifactSha256 = 'f'.repeat(64); }, 'MISSING_ARTIFACT');
    blocked((value) => {
      const invariant = value.soak.finalInvariants.find((entry) => entry.id === 'bounded-resource-growth');
      invariant.observed.fdGrowth = MAX_FD_GROWTH + 1;
    }, 'INVARIANT_FAILED');
    blocked((value) => { value.soak.artifacts = [artifact('LOG')]; }, 'MISSING_ARTIFACT');
  });

  test('uses validator-owned freshness, signing delay, and exact UTC instants', () => {
    blocked((value) => {
      value.gateway.startedAt = iso(NOW - 26 * HOUR);
      value.gateway.completedAt = iso(NOW - 25 * HOUR);
      value.gateway.issuedAt = iso(NOW - 24.5 * HOUR);
      value.gateway.expiresAt = iso(NOW - HOUR);
    }, 'STALE_EVIDENCE');
    blocked((value) => { value.visual.expiresAt = iso(NOW + 7 * 24 * HOUR); }, 'INVALID_EXPIRY');
    blocked((value) => { value.soak.issuedAt = iso(NOW - 30 * 60 * 1000); }, 'INVALID_ISSUANCE');
    blocked((value) => { value.gateway.completedAt = '2026-02-30T10:00:00.000Z'; }, 'INVALID_VALUE');
  });

  test('rejects unknown fields, duplicate JSON keys, and external claims by quality evidence', () => {
    blocked((value) => { value.gateway.outcome = 'PASS'; }, 'UNKNOWN_FIELD');
    blocked((value) => { value.quality.externalAcceptance = 'PASS'; }, 'BOUNDARY_VIOLATION');
    assert.throws(
      () => parseStrictJson('{"repo":"one/repo","repo":"two/repo"}', 'gateway'),
      (error) => error?.code === 'DUPLICATE_JSON_KEY',
    );
    assert.deepEqual(parseStrictJson('{"nested":{"ok":true}}'), { nested: { ok: true } });
  });
});

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function physicalFixture(t) {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'junqi-external-evidence-'));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const evidencePath = path.join(rootPath, 'collaboration-gateway-release-evidence.json');
  const artifactName = 'observations/p0-01.json';
  const artifactPath = path.join(rootPath, ...artifactName.split('/'));
  const bytes = Buffer.from('{"status":"PASS"}\n');
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await Promise.all([
    writeFile(evidencePath, '{}\n'),
    writeFile(artifactPath, bytes),
  ]);
  return {
    rootPath,
    evidencePath,
    artifactPath,
    reference: { kind: 'OBSERVATION', name: artifactName, sha256: digest(bytes), bytes: bytes.length },
  };
}

async function p014PhysicalFixture(t) {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'junqi-p014-trace-'));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const evidencePath = path.join(rootPath, 'collaboration-gateway-release-evidence.json');
  const proof = p014Proof();
  const traceBytes = p014TraceBytes(proof);
  const tracePath = path.join(rootPath, proof.traceArtifact.name);
  assert.equal(digest(traceBytes), proof.traceArtifact.sha256);
  assert.equal(traceBytes.length, proof.traceArtifact.bytes);
  await Promise.all([
    writeFile(evidencePath, '{}\n'),
    writeFile(tracePath, traceBytes),
  ]);
  return {
    rootPath,
    evidencePath,
    tracePath,
    traceBytes,
    proof,
    reference: {
      kind: proof.traceArtifact.kind,
      name: proof.traceArtifact.name,
      sha256: proof.traceArtifact.sha256,
      bytes: proof.traceArtifact.bytes,
    },
    p014Trace: {
      proof,
      workflowRunId: RUN_IDS.gateway,
      workflowRunAttempt: PRODUCERS.gateway.runAttempt,
      caseId: 'P0-14',
    },
  };
}

describe('physical artifact closure', () => {
  test('verifies exact regular files, bytes, and SHA-256', async (t) => {
    const fixture = await physicalFixture(t);
    const result = await verifyPhysicalArtifactRoot({
      rootPath: fixture.rootPath,
      evidencePath: fixture.evidencePath,
      references: [fixture.reference],
      field: 'gatewayArtifactRoot',
    });
    assert.equal(result.filesVerified, 1);
    assert.equal(result.bytesVerified, fixture.reference.bytes);
  });

  test('rejects physical size and digest mismatches', async (t) => {
    const sizeFixture = await physicalFixture(t);
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: sizeFixture.rootPath,
        evidencePath: sizeFixture.evidencePath,
        references: [{ ...sizeFixture.reference, bytes: sizeFixture.reference.bytes + 1 }],
        field: 'gatewayArtifactRoot',
      }),
      (error) => error?.code === 'ARTIFACT_SIZE_MISMATCH',
    );

    const digestFixture = await physicalFixture(t);
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: digestFixture.rootPath,
        evidencePath: digestFixture.evidencePath,
        references: [{ ...digestFixture.reference, sha256: 'f'.repeat(64) }],
        field: 'gatewayArtifactRoot',
      }),
      (error) => error?.code === 'ARTIFACT_DIGEST_MISMATCH',
    );
  });

  test('rejects forbidden credentials in referenced text evidence', async (t) => {
    const fixture = await physicalFixture(t);
    const bytes = Buffer.from('authorization: Bearer ghp_123456789012345678901234567890\n');
    await writeFile(fixture.artifactPath, bytes);
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [{
          ...fixture.reference,
          kind: 'LOG',
          sha256: digest(bytes),
          bytes: bytes.length,
        }],
        field: 'gatewayArtifactRoot',
      }),
      (error) => error?.code === 'SECRET_IN_ARTIFACT',
    );
  });

  test('rejects unreferenced files and any symbolic link in the root', async (t) => {
    const extraFixture = await physicalFixture(t);
    await writeFile(path.join(extraFixture.rootPath, 'unreferenced.log'), 'extra\n');
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: extraFixture.rootPath,
        evidencePath: extraFixture.evidencePath,
        references: [extraFixture.reference],
        field: 'gatewayArtifactRoot',
      }),
      (error) => error?.code === 'UNREFERENCED_ARTIFACT_FILE',
    );

    const symlinkFixture = await physicalFixture(t);
    await symlink(symlinkFixture.artifactPath, path.join(symlinkFixture.rootPath, 'forbidden-link'));
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: symlinkFixture.rootPath,
        evidencePath: symlinkFixture.evidencePath,
        references: [symlinkFixture.reference],
        field: 'gatewayArtifactRoot',
      }),
      (error) => error?.code === 'SYMLINK_FORBIDDEN',
    );
  });

  test('binds the physical P0-14 trace to the complete proof and workflow run', async (t) => {
    const fixture = await p014PhysicalFixture(t);
    const result = await verifyPhysicalArtifactRoot({
      rootPath: fixture.rootPath,
      evidencePath: fixture.evidencePath,
      references: [fixture.reference],
      field: 'gatewayArtifactRoot',
      p014Trace: fixture.p014Trace,
    });
    assert.equal(result.p014TraceVerified, true);

    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [fixture.reference],
        field: 'gatewayArtifactRoot',
      }),
      (error) => error?.code === 'P014_TRACE_BINDING_REQUIRED',
    );

    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [fixture.reference],
        field: 'gatewayArtifactRoot',
        p014Trace: { ...fixture.p014Trace, workflowRunId: '999' },
      }),
      (error) => error?.code === 'P014_TRACE_BINDING_MISMATCH',
    );

    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [fixture.reference],
        field: 'gatewayArtifactRoot',
        p014Trace: { ...fixture.p014Trace, workflowRunAttempt: 2 },
      }),
      (error) => error?.code === 'P014_TRACE_BINDING_MISMATCH',
    );

    const reboundProof = structuredClone(fixture.proof);
    reboundProof.mutations.reset.requestedKey = 'agent-main-reset-rebound';
    reboundProof.mutations.reset.response.key = 'agent-main-reset-rebound';
    reboundProof.traceArtifact.claimsSha256 = digest(
      Buffer.from(stableJson(p014TraceClaims(reboundProof))),
    );
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [fixture.reference],
        field: 'gatewayArtifactRoot',
        p014Trace: { ...fixture.p014Trace, proof: reboundProof },
      }),
      (error) => error?.code === 'P014_TRACE_BINDING_MISMATCH',
    );
  });

  test('rejects a non-canonical P0-14 trace even when its artifact digest is updated', async (t) => {
    const fixture = await p014PhysicalFixture(t);
    const document = JSON.parse(fixture.traceBytes.toString('utf8'));
    const nonCanonicalBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    await writeFile(fixture.tracePath, nonCanonicalBytes);
    const reference = {
      ...fixture.reference,
      sha256: digest(nonCanonicalBytes),
      bytes: nonCanonicalBytes.length,
    };
    const proof = structuredClone(fixture.proof);
    proof.traceArtifact.sha256 = reference.sha256;
    proof.traceArtifact.bytes = reference.bytes;
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [reference],
        field: 'gatewayArtifactRoot',
        p014Trace: { ...fixture.p014Trace, proof },
      }),
      (error) => error?.code === 'P014_TRACE_NON_CANONICAL',
    );
  });

  test('rejects a UTF-8 BOM even when the P0-14 artifact digest is updated', async (t) => {
    const fixture = await p014PhysicalFixture(t);
    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture.traceBytes]);
    await writeFile(fixture.tracePath, bomBytes);
    const reference = {
      ...fixture.reference,
      sha256: digest(bomBytes),
      bytes: bomBytes.length,
    };
    const proof = structuredClone(fixture.proof);
    proof.traceArtifact.sha256 = reference.sha256;
    proof.traceArtifact.bytes = reference.bytes;
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [reference],
        field: 'gatewayArtifactRoot',
        p014Trace: { ...fixture.p014Trace, proof },
      }),
      (error) => error?.code === 'INVALID_JSON' || error?.code === 'P014_TRACE_NON_CANONICAL',
    );
  });

  test('rebuilds proof claims from events instead of trusting a duplicated claims object', async (t) => {
    const fixture = await p014PhysicalFixture(t);
    const document = JSON.parse(fixture.traceBytes.toString('utf8'));
    document.events[4].requestedKey = 'agent-main-reset-rebound';
    document.events[4].response = { ok: true, key: 'agent-main-reset-rebound' };
    const mutatedBytes = Buffer.from(`${stableJson(document)}\n`);
    const reference = {
      ...fixture.reference,
      sha256: digest(mutatedBytes),
      bytes: mutatedBytes.length,
    };
    const proof = structuredClone(fixture.proof);
    proof.traceArtifact.sha256 = reference.sha256;
    proof.traceArtifact.bytes = reference.bytes;
    proof.traceArtifact.eventsSha256 = digest(Buffer.from(stableJson(document.events)));
    await writeFile(fixture.tracePath, mutatedBytes);
    await assert.rejects(
      verifyPhysicalArtifactRoot({
        rootPath: fixture.rootPath,
        evidencePath: fixture.evidencePath,
        references: [reference],
        field: 'gatewayArtifactRoot',
        p014Trace: { ...fixture.p014Trace, proof },
      }),
      (error) => error?.code === 'P014_TRACE_BINDING_MISMATCH',
    );
  });

  test('binds the visual candidate to an exact current release asset', async (t) => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'junqi-release-assets-'));
    t.after(() => rm(rootPath, { recursive: true, force: true }));
    const bytes = Buffer.from('signed-installer-bytes');
    await writeFile(path.join(rootPath, VISUAL_CANDIDATE_NAME), bytes);
    const candidate = {
      platform: 'WINDOWS',
      artifactName: VISUAL_CANDIDATE_NAME,
      artifactSha256: digest(bytes),
    };
    const result = await verifyVisualCandidateAgainstReleaseAssets({ rootPath, candidate });
    assert.equal(result.candidate.artifactName, VISUAL_CANDIDATE_NAME);
    assert.equal(result.manifest.length, 1);

    await writeFile(path.join(rootPath, 'junqi-desktop-macos-universal.dmg'), 'another-asset');
    await assert.rejects(
      verifyVisualCandidateAgainstReleaseAssets({ rootPath, candidate }),
      (error) => error?.code === 'VISUAL_PLATFORM_COVERAGE_REQUIRED',
    );
    await rm(path.join(rootPath, 'junqi-desktop-macos-universal.dmg'));

    await assert.rejects(
      verifyVisualCandidateAgainstReleaseAssets({
        rootPath,
        candidate: { ...candidate, artifactSha256: 'f'.repeat(64) },
      }),
      (error) => error?.code === 'VISUAL_CANDIDATE_DIGEST_MISMATCH',
    );
  });
});
