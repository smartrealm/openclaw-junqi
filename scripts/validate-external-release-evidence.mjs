#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFICIAL_OPENCLAW_IMAGE_DIGEST,
  OFFICIAL_OPENCLAW_VERSION,
} from './verify-collaboration-real-gateway.mjs';
import {
  TRUSTED_EVIDENCE_WORKFLOWS,
} from './collaboration-release-evidence-contract.mjs';
import {
  MAX_EVIDENCE_ARTIFACT_DEPTH,
  MAX_EVIDENCE_ARTIFACT_ENTRIES,
  MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES,
  scanTextChunk,
  shouldScanEvidenceKind,
} from './evidence-content-policy.mjs';

export { TRUSTED_EVIDENCE_WORKFLOWS };

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const EXTERNAL_EVIDENCE_SCHEMA_VERSION = 1;
export const EXTERNAL_RELEASE_POLICY_VERSION = 7;
export const MAX_EVIDENCE_BYTES = 1024 * 1024;
export const MAX_REFERENCED_ARTIFACT_BYTES = 512 * 1024 * 1024;
export const MAX_ARTIFACT_ROOT_ENTRIES = MAX_EVIDENCE_ARTIFACT_ENTRIES;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_SIGNING_DELAY_MS = 60 * 60 * 1000;
export const MIN_SOAK_DURATION_MS = 24 * 60 * 60 * 1000;
export const SOAK_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_SOAK_WALL_CLOCK_DRIFT_MS = 5 * 60 * 1000;
export const MAX_RSS_GROWTH_BYTES = 256 * 1024 * 1024;
export const MAX_FD_GROWTH = 32;

export const REQUIRED_P0_CASE_IDS = Object.freeze(
  Array.from({ length: 14 }, (_, index) => `P0-${String(index + 1).padStart(2, '0')}`),
);

// P0-14 is a security-boundary proof rather than a generic RPC smoke test.
// Keep its schema explicit so a producer cannot satisfy the release gate with
// unrelated runtime identities or a capabilities-only observation.
export const P014_PROOF_SCHEMA_VERSION = 3;
export const P014_TRACE_SCHEMA_VERSION = 1;
export const P014_TRACE_ARTIFACT_KIND = 'P014_TRACE';
export const MAX_P014_TRACE_BYTES = 1024 * 1024;
export const P014_TRACE_EVENT_COUNT = 24;
export const REQUIRED_P014_NEGATIVE_PROBE_IDS = Object.freeze([
  'plugin-present',
  'durable-present',
  'corrupt',
  'unknown',
  'identity-mismatch',
]);

export const P014_NEGATIVE_PROBE_REQUIREMENTS = Object.freeze({
  'plugin-present': Object.freeze({
    identityMatch: true,
    observedPluginSnapshot: 'PRESENT',
    observedDurableState: 'ABSENT',
    rejectionCode: 'PLUGIN_NOT_PROVEN_MISSING',
  }),
  'durable-present': Object.freeze({
    identityMatch: true,
    observedPluginSnapshot: 'MISSING',
    observedDurableState: 'PRESENT',
    rejectionCode: 'DURABLE_STATE_NOT_ABSENT',
  }),
  corrupt: Object.freeze({
    identityMatch: true,
    observedPluginSnapshot: 'MISSING',
    observedDurableState: 'CORRUPT',
    rejectionCode: 'DURABLE_STATE_NOT_ABSENT',
  }),
  unknown: Object.freeze({
    identityMatch: true,
    observedPluginSnapshot: 'UNKNOWN',
    observedDurableState: 'UNKNOWN',
    rejectionCode: 'PROBE_NOT_AUTHORITATIVE',
  }),
  'identity-mismatch': Object.freeze({
    identityMatch: false,
    observedPluginSnapshot: 'MISSING',
    observedDurableState: 'ABSENT',
    rejectionCode: 'PROBE_IDENTITY_MISMATCH',
  }),
});

export const REQUIRED_VISUAL_VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ id: 'mobile', width: 390, height: 844 }),
]);

export const REQUIRED_VISUAL_SCENARIOS = Object.freeze([
  'plan-approval',
  'active-run',
  'intervention',
  'history-recovery',
  'deletion-three-gates-tombstone',
  'projection-rebind-no-stale-flash',
]);

export const REQUIRED_VISUAL_ASSERTIONS = Object.freeze({
  'plan-approval': Object.freeze(['plan-visible', 'approval-action']),
  'active-run': Object.freeze(['work-items-visible', 'agent-identity-visible']),
  intervention: Object.freeze(['intervention-visible', 'recovery-action']),
  'history-recovery': Object.freeze(['history-entry-visible', 'timeline-complete']),
  'deletion-three-gates-tombstone': Object.freeze([
    'preview-confirmation',
    'abandonment-confirmation',
    'tombstone-visible',
  ]),
  'projection-rebind-no-stale-flash': Object.freeze([
    'runtime-switch-invalidates',
    'no-stale-projection',
  ]),
});

export const VISUAL_CANDIDATE_ASSET_POLICY = Object.freeze({
  MACOS: Object.freeze(['.dmg']),
  WINDOWS: Object.freeze(['.exe', '.msi']),
});

export const REQUIRED_SOAK_FAULT_IDS = Object.freeze([
  'gateway-restart',
  'network-fault',
  'disk-fault',
  'task-retention',
  'flow-retention',
  'security-boundary',
]);

export const REQUIRED_SOAK_INVARIANT_IDS = Object.freeze([
  'database-integrity',
  'no-unfinished-commands',
  'no-duplicate-effects',
  'no-duplicate-agent-execution',
  'no-orphaned-active-task',
  'no-unresolved-flow-reconciliation',
  'no-task-retention-violations',
  'no-flow-retention-violations',
  'no-secret-in-evidence',
  'bounded-resource-growth',
]);

export const EXTERNAL_EVIDENCE_MAX_AGE_MS = Object.freeze({
  GATEWAY: 24 * 60 * 60 * 1000,
  VISUAL: 72 * 60 * 60 * 1000,
  SOAK: 7 * 24 * 60 * 60 * 1000,
});

const TEST_PLAN = Object.freeze({
  schemaVersion: EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  policyVersion: EXTERNAL_RELEASE_POLICY_VERSION,
  gateway: Object.freeze({
    cases: REQUIRED_P0_CASE_IDS,
    p014: Object.freeze({
      schemaVersion: P014_PROOF_SCHEMA_VERSION,
      requiredNegativeProbes: REQUIRED_P014_NEGATIVE_PROBE_IDS,
      negativeProbeRequirements: P014_NEGATIVE_PROBE_REQUIREMENTS,
      requiredCoreMethods: Object.freeze(['sessions.reset', 'sessions.delete']),
      requiredMaintenance: Object.freeze({ callbackInvocationCount: 1, guarded: false, effectCalls: 1 }),
      requiredCapabilitiesClassification: Object.freeze({
        method: 'junqi.collab.capabilities',
        code: 'INVALID_REQUEST',
        classification: 'METHOD_NOT_FOUND',
      }),
      forbiddenNegativeProbeCoreRpcCalls: 0,
      forbiddenNegativeProbeEffectCalls: 0,
      requiredTrace: Object.freeze({
        schemaVersion: P014_TRACE_SCHEMA_VERSION,
        artifactKind: P014_TRACE_ARTIFACT_KIND,
        eventCount: P014_TRACE_EVENT_COUNT,
        maximumBytes: MAX_P014_TRACE_BYTES,
        canonicalClaims: true,
        physicalContentBinding: true,
        workflowRunAttemptBinding: true,
      }),
    }),
  }),
  visual: Object.freeze({
    viewports: REQUIRED_VISUAL_VIEWPORTS,
    scenarios: REQUIRED_VISUAL_SCENARIOS,
    assertions: REQUIRED_VISUAL_ASSERTIONS,
    requiredArtifactKinds: Object.freeze(['SCREENSHOT', 'INTERACTION_TRACE']),
    candidateAssetPolicy: VISUAL_CANDIDATE_ASSET_POLICY,
    requiredCandidateArtifactKind: 'CANDIDATE_INSTALLER',
  }),
  soak: Object.freeze({
    minimumDurationMs: MIN_SOAK_DURATION_MS,
    heartbeatIntervalMs: SOAK_HEARTBEAT_INTERVAL_MS,
    maximumWallClockDriftMs: MAX_SOAK_WALL_CLOCK_DRIFT_MS,
    faults: REQUIRED_SOAK_FAULT_IDS,
    finalInvariants: REQUIRED_SOAK_INVARIANT_IDS,
    thresholds: Object.freeze({
      maximumRssGrowthBytes: MAX_RSS_GROWTH_BYTES,
      maximumFdGrowth: MAX_FD_GROWTH,
    }),
    requiredArtifactKinds: Object.freeze(['LOG', 'METRICS']),
  }),
  maximumAgeMs: EXTERNAL_EVIDENCE_MAX_AGE_MS,
  maximumSigningDelayMs: MAX_SIGNING_DELAY_MS,
  maximumClockSkewMs: MAX_CLOCK_SKEW_MS,
  physicalArtifacts: Object.freeze({
    maximumArtifactBytes: MAX_REFERENCED_ARTIFACT_BYTES,
    maximumRootEntries: MAX_ARTIFACT_ROOT_ENTRIES,
    safeRelativePaths: true,
    uniqueReferencesPerEvidenceType: true,
    exactDirectoryClosure: true,
    noSymbolicLinks: true,
  }),
  trustedEvidenceWorkflows: TRUSTED_EVIDENCE_WORKFLOWS,
  gatewayRuntime: Object.freeze({
    openclawVersion: OFFICIAL_OPENCLAW_VERSION,
    imageDigest: OFFICIAL_OPENCLAW_IMAGE_DIGEST,
    scope: 'FULL_BEHAVIORAL',
  }),
});

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export const EXTERNAL_RELEASE_TEST_PLAN_SHA256 = sha256(stableJson(TEST_PLAN));

export class ExternalEvidenceValidationError extends Error {
  constructor(code, field, message) {
    super(message);
    this.name = 'ExternalEvidenceValidationError';
    this.code = code;
    this.field = field;
  }
}

function reject(code, field, message) {
  throw new ExternalEvidenceValidationError(code, field, message);
}

function check(condition, code, field, message) {
  if (!condition) reject(code, field, message);
}

function object(value, field) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_TYPE', field, `${field} must be an object`);
  return value;
}

function exactKeys(value, requiredKeys, optionalKeys, field) {
  const keys = Object.keys(value).sort();
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  const unknown = keys.filter((key) => !allowed.has(key));
  check(missing.length === 0, 'MISSING_FIELD', field, `${field} is missing fields: ${missing.join(', ')}`);
  check(unknown.length === 0, 'UNKNOWN_FIELD', field, `${field} contains unknown fields: ${unknown.join(', ')}`);
  return value;
}

function array(value, field, maximum = 256) {
  check(Array.isArray(value), 'INVALID_TYPE', field, `${field} must be an array`);
  check(value.length <= maximum, 'LIMIT_EXCEEDED', field, `${field} contains too many entries`);
  return value;
}

function string(value, field, pattern = undefined) {
  check(typeof value === 'string', 'INVALID_TYPE', field, `${field} must be a string`);
  const normalized = value.trim();
  check(normalized.length > 0 && normalized.length <= 512, 'INVALID_VALUE', field, `${field} must be bounded and non-empty`);
  check(!normalized.includes('\n') && !normalized.includes('\r'), 'INVALID_VALUE', field, `${field} must be a single line`);
  if (pattern) check(pattern.test(normalized), 'INVALID_VALUE', field, `${field} has an invalid format`);
  return normalized;
}

function safeArtifactPath(value, field) {
  const normalized = string(value, field);
  check(value === normalized, 'UNSAFE_ARTIFACT_PATH', field, `${field} must not contain surrounding whitespace`);
  check(
    !normalized.includes('\\') && !normalized.includes('\0'),
    'UNSAFE_ARTIFACT_PATH',
    field,
    `${field} contains a forbidden path character`,
  );
  check(
    !path.posix.isAbsolute(normalized) && !path.win32.isAbsolute(normalized),
    'UNSAFE_ARTIFACT_PATH',
    field,
    `${field} must be a relative path`,
  );
  const segments = normalized.split('/');
  check(
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    'UNSAFE_ARTIFACT_PATH',
    field,
    `${field} contains an empty or traversal segment`,
  );
  return normalized;
}

function validateVisualCandidateAsset(platformValue, nameValue, digestValue, field) {
  const platform = string(platformValue, `${field}.platform`);
  const extensions = VISUAL_CANDIDATE_ASSET_POLICY[platform];
  check(extensions !== undefined, 'INVALID_VALUE', `${field}.platform`, 'Visual candidate platform is not published by this release workflow');
  const artifactName = safeArtifactPath(nameValue, `${field}.artifactName`);
  check(!artifactName.includes('/'), 'UNSAFE_ARTIFACT_PATH', `${field}.artifactName`, 'Visual candidate asset name must not contain directories');
  check(
    extensions.some((extension) => artifactName.toLowerCase().endsWith(extension)),
    'INVALID_VALUE',
    `${field}.artifactName`,
    `Visual candidate asset extension is invalid for ${platform}`,
  );
  return {
    platform,
    artifactName,
    artifactSha256: sha(digestValue, `${field}.artifactSha256`),
  };
}

function sha(value, field) {
  return string(value, field, /^[a-f0-9]{64}$/);
}

function gitObject(value, field) {
  return string(value, field, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
}

function positiveInteger(value, field, allowZero = false) {
  check(Number.isSafeInteger(value), 'INVALID_TYPE', field, `${field} must be a safe integer`);
  check(allowZero ? value >= 0 : value > 0, 'INVALID_VALUE', field, `${field} must be ${allowZero ? 'non-negative' : 'positive'}`);
  return value;
}

function positiveNumber(value, field) {
  check(typeof value === 'number' && Number.isFinite(value) && value > 0, 'INVALID_VALUE', field, `${field} must be a positive finite number`);
  return value;
}

function boolean(value, field) {
  check(typeof value === 'boolean', 'INVALID_TYPE', field, `${field} must be a boolean`);
  return value;
}

function runId(value, field) {
  check(typeof value === 'string', 'INVALID_TYPE', field, `${field} must be a decimal string`);
  return string(value, field, /^[1-9]\d*$/);
}

function instant(value, field) {
  const normalized = string(value, field, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const milliseconds = Date.parse(normalized);
  check(Number.isFinite(milliseconds), 'INVALID_VALUE', field, `${field} is not a valid UTC instant`);
  const canonical = normalized.includes('.') ? normalized : normalized.replace(/Z$/, '.000Z');
  check(new Date(milliseconds).toISOString() === canonical, 'INVALID_VALUE', field, `${field} is not a canonical UTC instant`);
  return milliseconds;
}

function exactSet(entries, required, field, idOf = (entry) => entry.id) {
  const ids = entries.map((entry, index) => string(idOf(entry), `${field}[${index}].id`));
  check(new Set(ids).size === ids.length, 'DUPLICATE_ENTRY', field, `${field} contains duplicate identifiers`);
  const requiredSet = new Set(required);
  const missing = required.filter((id) => !ids.includes(id));
  const unknown = ids.filter((id) => !requiredSet.has(id));
  check(missing.length === 0, 'MISSING_ENTRY', field, `${field} is missing: ${missing.join(', ')}`);
  check(unknown.length === 0, 'UNKNOWN_ENTRY', field, `${field} contains unknown entries: ${unknown.join(', ')}`);
  check(ids.length === required.length, 'INVALID_CARDINALITY', field, `${field} must contain the exact required set`);
}

function rejectSkipMarkers(value, field) {
  for (const marker of ['skip', 'skipped', 'skipReason', 'xfail', 'todo']) {
    check(!Object.hasOwn(value, marker), 'SKIP_FORBIDDEN', `${field}.${marker}`, `${field} must not contain skip markers`);
  }
}

function pass(value, field) {
  rejectSkipMarkers(value, field);
  check(value.status === 'PASS', 'NOT_PASSED', `${field}.status`, `${field}.status must be PASS`);
}

class ArtifactReferenceRegistry {
  constructor(field) {
    this.field = field;
    this.references = new Map();
  }

  add(artifact, field) {
    const previous = this.references.get(artifact.name);
    check(
      previous === undefined,
      'DUPLICATE_ARTIFACT_REFERENCE',
      field,
      `${field} reuses artifact path ${artifact.name} already referenced by ${previous?.field ?? this.field}`,
    );
    this.references.set(artifact.name, { ...artifact, field });
  }

  hasDigest(digest) {
    return Array.from(this.references.values()).some((reference) => reference.sha256 === digest);
  }

  values() {
    return Array.from(this.references.values(), ({ field: _field, ...reference }) => reference);
  }
}

function validateArtifact(value, field) {
  const artifact = object(value, field);
  exactKeys(artifact, ['kind', 'name', 'sha256', 'bytes'], [], field);
  const kind = string(artifact.kind, `${field}.kind`, /^[A-Z][A-Z0-9_]{1,63}$/);
  const name = safeArtifactPath(artifact.name, `${field}.name`);
  const digest = sha(artifact.sha256, `${field}.sha256`);
  const bytes = positiveInteger(artifact.bytes, `${field}.bytes`);
  check(
    bytes <= MAX_REFERENCED_ARTIFACT_BYTES,
    'LIMIT_EXCEEDED',
    `${field}.bytes`,
    `${field}.bytes exceeds the physical artifact limit`,
  );
  return { kind, name, sha256: digest, bytes };
}

function validateArtifacts(value, field, requiredKinds, registry) {
  const artifacts = array(value, field, 64).map((entry, index) => validateArtifact(entry, `${field}[${index}]`));
  check(artifacts.length > 0, 'MISSING_ARTIFACT', field, `${field} must not be empty`);
  const identities = artifacts.map((artifact) => `${artifact.kind}\0${artifact.name}`);
  check(new Set(identities).size === identities.length, 'DUPLICATE_ENTRY', field, `${field} contains duplicate artifacts`);
  for (const kind of requiredKinds) {
    check(artifacts.some((artifact) => artifact.kind === kind), 'MISSING_ARTIFACT', field, `${field} requires a ${kind} artifact`);
  }
  artifacts.forEach((artifact, index) => registry.add(artifact, `${field}[${index}].name`));
  return artifacts;
}

function validateUniqueStrings(value, field, maximum = 128) {
  const values = array(value, field, maximum).map((entry, index) => string(entry, `${field}[${index}]`));
  check(new Set(values).size === values.length, 'DUPLICATE_ENTRY', field, `${field} contains duplicates`);
  return values;
}

function validateQualityEvidence(value) {
  const quality = object(value, 'quality');
  exactKeys(quality, [
    'schemaVersion',
    'evidenceType',
    'repo',
    'source',
    'desktop',
    'plugin',
    'sha256',
    'toolchain',
    'workflow',
    'externalAcceptance',
  ], [], 'quality');
  check(quality.schemaVersion === 1, 'SCHEMA_MISMATCH', 'quality.schemaVersion', 'Unsupported automated quality evidence schema');
  check(quality.evidenceType === 'AUTOMATED_QUALITY', 'TYPE_MISMATCH', 'quality.evidenceType', 'Expected automated quality evidence');
  check(quality.externalAcceptance === 'NOT_EVALUATED', 'BOUNDARY_VIOLATION', 'quality.externalAcceptance', 'Automated quality evidence must not claim external acceptance');
  const source = object(quality.source, 'quality.source');
  exactKeys(source, ['commit', 'tree'], [], 'quality.source');
  const desktop = object(quality.desktop, 'quality.desktop');
  exactKeys(desktop, ['name', 'version'], [], 'quality.desktop');
  check(desktop.name === 'junqi-desktop', 'SUBJECT_MISMATCH', 'quality.desktop.name', 'Automated quality evidence identifies the wrong desktop package');
  const plugin = object(quality.plugin, 'quality.plugin');
  exactKeys(plugin, ['id', 'packageName', 'version', 'schemaVersion'], [], 'quality.plugin');
  check(plugin.packageName === '@junqi/openclaw-collaboration', 'SUBJECT_MISMATCH', 'quality.plugin.packageName', 'Automated quality evidence identifies the wrong plugin package');
  const hashes = object(quality.sha256, 'quality.sha256');
  exactKeys(hashes, ['bundle', 'metadata', 'lockfiles'], [], 'quality.sha256');
  const metadataHashes = object(hashes.metadata, 'quality.sha256.metadata');
  exactKeys(metadataHashes, ['resource', 'generated'], [], 'quality.sha256.metadata');
  const lockHashes = object(hashes.lockfiles, 'quality.sha256.lockfiles');
  exactKeys(lockHashes, ['pnpm', 'cargo'], [], 'quality.sha256.lockfiles');
  const toolchain = object(quality.toolchain, 'quality.toolchain');
  exactKeys(toolchain, ['node', 'pnpm', 'rustc', 'cargo'], [], 'quality.toolchain');
  for (const [key, value] of Object.entries(toolchain)) string(value, `quality.toolchain.${key}`);
  const workflow = object(quality.workflow, 'quality.workflow');
  exactKeys(workflow, ['runId', 'runAttempt', 'prerequisiteJobs'], [], 'quality.workflow');
  runId(workflow.runId, 'quality.workflow.runId');
  positiveInteger(workflow.runAttempt, 'quality.workflow.runAttempt');
  const prerequisiteJobs = array(workflow.prerequisiteJobs, 'quality.workflow.prerequisiteJobs', 8);
  exactSet(prerequisiteJobs, ['quality-node', 'quality-rust'], 'quality.workflow.prerequisiteJobs', (entry) => entry);
  sha(metadataHashes.resource, 'quality.sha256.metadata.resource');
  sha(metadataHashes.generated, 'quality.sha256.metadata.generated');
  sha(lockHashes.pnpm, 'quality.sha256.lockfiles.pnpm');
  sha(lockHashes.cargo, 'quality.sha256.lockfiles.cargo');
  return {
    repo: string(quality.repo, 'quality.repo', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    commit: gitObject(source.commit, 'quality.source.commit'),
    tree: gitObject(source.tree, 'quality.source.tree'),
    desktopVersion: string(desktop.version, 'quality.desktop.version'),
    bundleSha256: sha(hashes.bundle, 'quality.sha256.bundle'),
    pluginId: string(plugin.id, 'quality.plugin.id'),
    pluginVersion: string(plugin.version, 'quality.plugin.version'),
    schemaVersion: positiveInteger(plugin.schemaVersion, 'quality.plugin.schemaVersion'),
  };
}

function validateBase(value, evidenceType, expected, producer, releaseRef, nowMs, typeSpecificKeys) {
  const field = evidenceType.toLowerCase();
  const evidence = object(value, field);
  exactKeys(evidence, [
    'schemaVersion',
    'evidenceType',
    'repo',
    'source',
    'bundleSha256',
    'plugin',
    'policy',
    'workflow',
    'startedAt',
    'completedAt',
    'issuedAt',
    'expiresAt',
    ...typeSpecificKeys,
  ], [], field);
  check(evidence.schemaVersion === EXTERNAL_EVIDENCE_SCHEMA_VERSION, 'SCHEMA_MISMATCH', `${field}.schemaVersion`, 'Unsupported external evidence schema');
  check(evidence.evidenceType === evidenceType, 'TYPE_MISMATCH', `${field}.evidenceType`, `Expected ${evidenceType} evidence`);
  const source = object(evidence.source, `${field}.source`);
  exactKeys(source, ['commit', 'tree'], [], `${field}.source`);
  const plugin = object(evidence.plugin, `${field}.plugin`);
  exactKeys(plugin, ['id', 'version', 'schemaVersion'], [], `${field}.plugin`);
  const policy = object(evidence.policy, `${field}.policy`);
  exactKeys(policy, ['version', 'testPlanSha256'], [], `${field}.policy`);
  const workflow = object(evidence.workflow, `${field}.workflow`);
  exactKeys(workflow, ['repo', 'path', 'ref', 'runId', 'runAttempt'], [], `${field}.workflow`);

  check(string(evidence.repo, `${field}.repo`) === expected.repo, 'SUBJECT_MISMATCH', `${field}.repo`, 'Evidence repository differs from automated quality evidence');
  check(gitObject(source.commit, `${field}.source.commit`) === expected.commit, 'SUBJECT_MISMATCH', `${field}.source.commit`, 'Evidence commit differs from automated quality evidence');
  check(gitObject(source.tree, `${field}.source.tree`) === expected.tree, 'SUBJECT_MISMATCH', `${field}.source.tree`, 'Evidence tree differs from automated quality evidence');
  check(sha(evidence.bundleSha256, `${field}.bundleSha256`) === expected.bundleSha256, 'SUBJECT_MISMATCH', `${field}.bundleSha256`, 'Evidence bundle differs from automated quality evidence');
  check(string(plugin.id, `${field}.plugin.id`) === expected.pluginId, 'SUBJECT_MISMATCH', `${field}.plugin.id`, 'Evidence plugin id differs');
  check(string(plugin.version, `${field}.plugin.version`) === expected.pluginVersion, 'SUBJECT_MISMATCH', `${field}.plugin.version`, 'Evidence plugin version differs');
  check(positiveInteger(plugin.schemaVersion, `${field}.plugin.schemaVersion`) === expected.schemaVersion, 'SUBJECT_MISMATCH', `${field}.plugin.schemaVersion`, 'Evidence schema version differs');
  check(policy.version === EXTERNAL_RELEASE_POLICY_VERSION, 'POLICY_MISMATCH', `${field}.policy.version`, 'Evidence policy version differs');
  check(sha(policy.testPlanSha256, `${field}.policy.testPlanSha256`) === EXTERNAL_RELEASE_TEST_PLAN_SHA256, 'POLICY_MISMATCH', `${field}.policy.testPlanSha256`, 'Evidence test plan differs');
  check(string(workflow.repo, `${field}.workflow.repo`) === expected.repo, 'PRODUCER_MISMATCH', `${field}.workflow.repo`, 'Evidence producer repository differs');
  check(workflow.path === TRUSTED_EVIDENCE_WORKFLOWS[evidenceType], 'PRODUCER_MISMATCH', `${field}.workflow.path`, 'Evidence producer workflow is not trusted');
  check(string(workflow.ref, `${field}.workflow.ref`) === releaseRef, 'PRODUCER_MISMATCH', `${field}.workflow.ref`, 'Evidence producer ref differs from the release tag');
  check(runId(workflow.runId, `${field}.workflow.runId`) === producer.runId, 'RUN_MISMATCH', `${field}.workflow.runId`, 'Evidence workflow run id differs');
  check(positiveInteger(workflow.runAttempt, `${field}.workflow.runAttempt`) === producer.runAttempt, 'RUN_MISMATCH', `${field}.workflow.runAttempt`, 'Evidence workflow run attempt differs');

  const startedAt = instant(evidence.startedAt, `${field}.startedAt`);
  const completedAt = instant(evidence.completedAt, `${field}.completedAt`);
  const issuedAt = instant(evidence.issuedAt, `${field}.issuedAt`);
  const expiresAt = instant(evidence.expiresAt, `${field}.expiresAt`);
  const maximumAge = EXTERNAL_EVIDENCE_MAX_AGE_MS[evidenceType];
  check(startedAt <= completedAt, 'INVALID_DURATION', `${field}.completedAt`, 'Evidence completed before it started');
  check(completedAt <= nowMs + MAX_CLOCK_SKEW_MS, 'FUTURE_EVIDENCE', `${field}.completedAt`, 'Evidence completed too far in the future');
  check(issuedAt <= nowMs + MAX_CLOCK_SKEW_MS, 'FUTURE_EVIDENCE', `${field}.issuedAt`, 'Evidence was issued too far in the future');
  check(issuedAt >= completedAt, 'INVALID_ISSUANCE', `${field}.issuedAt`, 'Evidence was issued before test completion');
  check(issuedAt - completedAt <= MAX_SIGNING_DELAY_MS, 'INVALID_ISSUANCE', `${field}.issuedAt`, 'Evidence was signed too long after test completion');
  check(nowMs - completedAt <= maximumAge, 'STALE_EVIDENCE', `${field}.completedAt`, 'Evidence exceeds the validator maximum age');
  check(expiresAt >= issuedAt, 'INVALID_EXPIRY', `${field}.expiresAt`, 'Evidence expiry precedes issuance');
  check(expiresAt - completedAt <= maximumAge, 'INVALID_EXPIRY', `${field}.expiresAt`, 'Evidence claims an expiry beyond the validator maximum age');
  check(nowMs <= expiresAt, 'STALE_EVIDENCE', `${field}.expiresAt`, 'Evidence has expired');

  return { evidence, startedAt, completedAt };
}

const P014_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@=+%~-]{0,255}$/;
const P014_SECRET_PATTERN = /(?:bearer\s+|basic\s+|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]|(?:ghp|github_pat|sk|xox[baprs])[-_][A-Za-z0-9_-]{8,})/i;
const P014_PLUGIN_SNAPSHOTS = Object.freeze(['MISSING', 'PRESENT', 'UNKNOWN']);
const P014_DURABLE_STATES = Object.freeze(['ABSENT', 'PRESENT', 'CORRUPT', 'UNKNOWN']);

function p014Id(value, field) {
  const normalized = string(value, field);
  check(value === normalized, 'UNSAFE_P014_VALUE', field, `${field} must not contain surrounding whitespace`);
  check(!P014_SECRET_PATTERN.test(normalized), 'SECRET_IN_EVIDENCE', field, `${field} contains a credential-like value`);
  check(P014_ID_PATTERN.test(normalized), 'UNSAFE_P014_VALUE', field, `${field} must be a bounded opaque identity`);
  // P0-14 fields are opaque identities, never filesystem paths. Excluding
  // separators makes absolute and traversal paths unrepresentable in proof.
  check(!normalized.includes('/') && !normalized.includes('\\'), 'UNSAFE_P014_VALUE', field, `${field} must be an opaque identity, not a path`);
  return normalized;
}

function p014Enum(value, field, allowed) {
  const normalized = string(value, field);
  check(allowed.includes(normalized), 'P014_STATE_MISMATCH', field, `${field} is not one of the allowed P0-14 states`);
  return normalized;
}

function p014RpcCount(value, field, expected) {
  const count = positiveInteger(value, field, true);
  check(count === expected, expected === 0 ? 'P014_CORE_RPC_FORBIDDEN' : 'P014_CORE_RPC_COUNT', field, `${field} must equal ${expected}`);
  return count;
}

function p014Binding(value, field, targetFingerprint, connectionId) {
  const binding = object(value, field);
  const observedTarget = p014Id(binding.targetFingerprint, `${field}.targetFingerprint`);
  const observedConnection = p014Id(binding.connectionId, `${field}.connectionId`);
  check(observedTarget === targetFingerprint && observedConnection === connectionId, 'P014_IDENTITY_MISMATCH', field, `${field} is not bound to the attested target and connection`);
  return binding;
}

function validateP014FixtureIdentity(value, field) {
  const identity = object(value, field);
  exactKeys(identity, ['targetFingerprint', 'connectionId'], [], field);
  return {
    targetFingerprint: p014Id(identity.targetFingerprint, `${field}.targetFingerprint`),
    connectionId: p014Id(identity.connectionId, `${field}.connectionId`),
  };
}

function p014IdentityKey(identity) {
  return `${identity.targetFingerprint}\0${identity.connectionId}`;
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

function p014TraceClaimsSha256(proof) {
  return sha256(stableJson(p014TraceClaims(proof)));
}

function validateP014TraceArtifactMetadata(value, field, caseArtifacts) {
  const trace = object(value, field);
  exactKeys(trace, ['kind', 'name', 'sha256', 'bytes', 'eventsSha256', 'claimsSha256'], [], field);
  const artifact = {
    kind: string(trace.kind, `${field}.kind`, /^[A-Z][A-Z0-9_]{1,63}$/),
    name: safeArtifactPath(trace.name, `${field}.name`),
    sha256: sha(trace.sha256, `${field}.sha256`),
    bytes: positiveInteger(trace.bytes, `${field}.bytes`),
  };
  check(
    artifact.kind === P014_TRACE_ARTIFACT_KIND,
    'P014_TRACE_ARTIFACT_MISMATCH',
    `${field}.kind`,
    `P0-14 trace artifact kind must be ${P014_TRACE_ARTIFACT_KIND}`,
  );
  check(
    artifact.bytes <= MAX_P014_TRACE_BYTES,
    'LIMIT_EXCEEDED',
    `${field}.bytes`,
    `${field}.bytes exceeds the P0-14 trace size limit`,
  );
  const claimsSha256 = sha(trace.claimsSha256, `${field}.claimsSha256`);
  const eventsSha256 = sha(trace.eventsSha256, `${field}.eventsSha256`);
  const traceReferences = caseArtifacts?.filter((reference) => reference.kind === P014_TRACE_ARTIFACT_KIND) ?? [];
  check(
    traceReferences.length === 1,
    'MISSING_ARTIFACT',
    field,
    'P0-14 requires exactly one physical trace artifact reference',
  );
  const registered = traceReferences[0];
  check(
    registered.name === artifact.name
      && registered.kind === artifact.kind
      && registered.sha256 === artifact.sha256
      && registered.bytes === artifact.bytes,
    'P014_TRACE_ARTIFACT_MISMATCH',
    field,
    'P0-14 trace metadata differs from its case artifact reference',
  );
  return { ...artifact, eventsSha256, claimsSha256 };
}

const P014_TRACE_EVENT_TYPES = Object.freeze({
  TARGET: 'TARGET_ATTESTED',
  CAPABILITIES: 'CAPABILITIES_PROBE',
  STATE: 'STATE_PROBE',
  CORE: 'CORE_RPC_EFFECT',
  MAINTENANCE: 'MAINTENANCE_EFFECT',
  NEGATIVE_BASELINE: 'NEGATIVE_BASELINE',
  NEGATIVE_OBSERVED: 'NEGATIVE_OBSERVED',
  NEGATIVE_DECISION: 'NEGATIVE_DECISION',
});

function nextP014TraceEvent(events, cursor, type, keys, field) {
  check(cursor.index < events.length, 'P014_TRACE_EVENT_MISMATCH', field, `${field} ended before the required event sequence`);
  const eventField = `${field}[${cursor.index}]`;
  const event = object(events[cursor.index], eventField);
  exactKeys(event, ['ordinal', 'type', ...keys], [], eventField);
  check(
    positiveInteger(event.ordinal, `${eventField}.ordinal`) === cursor.index + 1,
    'P014_TRACE_SEQUENCE_MISMATCH',
    `${eventField}.ordinal`,
    `${eventField}.ordinal must be contiguous and strictly increasing`,
  );
  check(
    string(event.type, `${eventField}.type`) === type,
    'P014_TRACE_EVENT_MISMATCH',
    `${eventField}.type`,
    `${eventField} has an unexpected event type`,
  );
  cursor.index += 1;
  return { event, field: eventField };
}

function parseP014TraceIdentity(value, field) {
  const identity = object(value, field);
  exactKeys(identity, ['targetFingerprint', 'connectionId'], [], field);
  return {
    targetFingerprint: p014Id(identity.targetFingerprint, `${field}.targetFingerprint`),
    connectionId: p014Id(identity.connectionId, `${field}.connectionId`),
  };
}

function assertP014TraceIdentity(identity, expected, field) {
  check(
    identity.targetFingerprint === expected.targetFingerprint
      && identity.connectionId === expected.connectionId,
    'P014_TRACE_IDENTITY_MISMATCH',
    field,
    `${field} is bound to a different target or connection`,
  );
}

function parseP014TraceState(value, field) {
  const state = object(value, field);
  exactKeys(state, ['pluginSnapshot', 'durableState'], [], field);
  return {
    pluginSnapshot: p014Enum(state.pluginSnapshot, `${field}.pluginSnapshot`, P014_PLUGIN_SNAPSHOTS),
    durableState: p014Enum(state.durableState, `${field}.durableState`, P014_DURABLE_STATES),
  };
}

function parseP014TraceStateEvent(events, cursor, role, targetIdentity, field) {
  const { event, field: eventField } = nextP014TraceEvent(
    events,
    cursor,
    P014_TRACE_EVENT_TYPES.STATE,
    ['role', 'sequence', 'targetFingerprint', 'connectionId', 'state', 'passed'],
    field,
  );
  check(string(event.role, `${eventField}.role`) === role, 'P014_TRACE_EVENT_MISMATCH', `${eventField}.role`, `${eventField} has an unexpected state-probe role`);
  const identity = {
    targetFingerprint: p014Id(event.targetFingerprint, `${eventField}.targetFingerprint`),
    connectionId: p014Id(event.connectionId, `${eventField}.connectionId`),
  };
  assertP014TraceIdentity(identity, targetIdentity, eventField);
  const state = parseP014TraceState(event.state, `${eventField}.state`);
  check(boolean(event.passed, `${eventField}.passed`) === true, 'P014_TRACE_EVENT_MISMATCH', `${eventField}.passed`, `${eventField} state probe did not pass`);
  return {
    sequence: p014Sequence(event.sequence, `${eventField}.sequence`),
    targetFingerprint: identity.targetFingerprint,
    connectionId: identity.connectionId,
    pluginSnapshot: state.pluginSnapshot,
    durableState: state.durableState,
    coreRpcCalls: 0,
    effectCalls: 0,
    passed: true,
  };
}

function parseP014TraceCoreEvent(events, cursor, method, targetIdentity, field, requiresDeleted) {
  const { event, field: eventField } = nextP014TraceEvent(
    events,
    cursor,
    P014_TRACE_EVENT_TYPES.CORE,
    ['sequence', 'method', 'targetFingerprint', 'connectionId', 'requestedKey', 'response'],
    field,
  );
  check(string(event.method, `${eventField}.method`) === method, 'P014_TRACE_EVENT_MISMATCH', `${eventField}.method`, `${eventField} used an unexpected core method`);
  const identity = {
    targetFingerprint: p014Id(event.targetFingerprint, `${eventField}.targetFingerprint`),
    connectionId: p014Id(event.connectionId, `${eventField}.connectionId`),
  };
  assertP014TraceIdentity(identity, targetIdentity, eventField);
  const requestedKey = p014Id(event.requestedKey, `${eventField}.requestedKey`);
  const response = object(event.response, `${eventField}.response`);
  exactKeys(response, requiresDeleted ? ['ok', 'key', 'deleted'] : ['ok', 'key'], [], `${eventField}.response`);
  check(boolean(response.ok, `${eventField}.response.ok`) === true, 'P014_TRACE_EVENT_MISMATCH', `${eventField}.response.ok`, `${eventField} did not return ok=true`);
  check(p014Id(response.key, `${eventField}.response.key`) === requestedKey, 'P014_TRACE_IDENTITY_MISMATCH', `${eventField}.response.key`, `${eventField} response key differs from its request`);
  if (requiresDeleted) check(boolean(response.deleted, `${eventField}.response.deleted`) === true, 'P014_TRACE_EVENT_MISMATCH', `${eventField}.response.deleted`, `${eventField} did not return deleted=true`);
  return {
    sequence: p014Sequence(event.sequence, `${eventField}.sequence`),
    method,
    targetFingerprint: identity.targetFingerprint,
    connectionId: identity.connectionId,
    requestedKey,
    response,
    coreRpcCalls: 1,
    effectCalls: 1,
  };
}

function parseP014TraceNegativeSnapshot(events, cursor, type, id, fixtureId, field) {
  const { event, field: eventField } = nextP014TraceEvent(
    events,
    cursor,
    type,
    ['id', 'fixtureId', 'sequence', 'identity', 'state'],
    field,
  );
  check(string(event.id, `${eventField}.id`) === id, 'P014_TRACE_EVENT_MISMATCH', `${eventField}.id`, `${eventField} belongs to a different negative scenario`);
  check(p014Id(event.fixtureId, `${eventField}.fixtureId`) === fixtureId, 'P014_TRACE_IDENTITY_MISMATCH', `${eventField}.fixtureId`, `${eventField} belongs to a different fixture`);
  const identity = parseP014TraceIdentity(event.identity, `${eventField}.identity`);
  const state = parseP014TraceState(event.state, `${eventField}.state`);
  return {
    sequence: p014Sequence(event.sequence, `${eventField}.sequence`),
    identity,
    state,
  };
}

function reconstructP014TraceClaims(value, field = 'p014Trace.events') {
  const events = array(value, field, P014_TRACE_EVENT_COUNT);
  check(events.length === P014_TRACE_EVENT_COUNT, 'P014_TRACE_EVENT_MISMATCH', field, `P0-14 trace must contain exactly ${P014_TRACE_EVENT_COUNT} events`);
  const cursor = { index: 0 };
  const targetRecord = nextP014TraceEvent(
    events,
    cursor,
    P014_TRACE_EVENT_TYPES.TARGET,
    ['targetFingerprint', 'connectionId', 'deploymentKind', 'pluginSnapshot', 'durableState'],
    field,
  );
  const targetIdentity = {
    targetFingerprint: p014Id(targetRecord.event.targetFingerprint, `${targetRecord.field}.targetFingerprint`),
    connectionId: p014Id(targetRecord.event.connectionId, `${targetRecord.field}.connectionId`),
  };
  const target = {
    ...targetIdentity,
    deploymentKind: string(targetRecord.event.deploymentKind, `${targetRecord.field}.deploymentKind`),
    pluginSnapshot: p014Enum(targetRecord.event.pluginSnapshot, `${targetRecord.field}.pluginSnapshot`, P014_PLUGIN_SNAPSHOTS),
    durableState: p014Enum(targetRecord.event.durableState, `${targetRecord.field}.durableState`, P014_DURABLE_STATES),
  };
  const capabilitiesRecord = nextP014TraceEvent(
    events,
    cursor,
    P014_TRACE_EVENT_TYPES.CAPABILITIES,
    ['sequence', 'targetFingerprint', 'connectionId', 'method', 'error', 'passed'],
    field,
  );
  const capabilitiesIdentity = {
    targetFingerprint: p014Id(capabilitiesRecord.event.targetFingerprint, `${capabilitiesRecord.field}.targetFingerprint`),
    connectionId: p014Id(capabilitiesRecord.event.connectionId, `${capabilitiesRecord.field}.connectionId`),
  };
  assertP014TraceIdentity(capabilitiesIdentity, targetIdentity, capabilitiesRecord.field);
  const capabilitiesError = object(capabilitiesRecord.event.error, `${capabilitiesRecord.field}.error`);
  exactKeys(capabilitiesError, ['code', 'classification', 'exact'], [], `${capabilitiesRecord.field}.error`);
  const capabilitiesProbe = {
    sequence: p014Sequence(capabilitiesRecord.event.sequence, `${capabilitiesRecord.field}.sequence`),
    targetFingerprint: capabilitiesIdentity.targetFingerprint,
    connectionId: capabilitiesIdentity.connectionId,
    method: string(capabilitiesRecord.event.method, `${capabilitiesRecord.field}.method`),
    error: {
      code: string(capabilitiesError.code, `${capabilitiesRecord.field}.error.code`),
      classification: string(capabilitiesError.classification, `${capabilitiesRecord.field}.error.classification`),
      exact: boolean(capabilitiesError.exact, `${capabilitiesRecord.field}.error.exact`),
    },
    coreRpcCalls: 1,
    effectCalls: 0,
    passed: boolean(capabilitiesRecord.event.passed, `${capabilitiesRecord.field}.passed`),
  };
  const absenceProbe = parseP014TraceStateEvent(events, cursor, 'INITIAL_ABSENCE', targetIdentity, field);
  const resetUsePointProbe = parseP014TraceStateEvent(events, cursor, 'RESET_USE_POINT', targetIdentity, field);
  const resetEffect = parseP014TraceCoreEvent(events, cursor, 'sessions.reset', targetIdentity, field, false);
  const deleteUsePointProbe = parseP014TraceStateEvent(events, cursor, 'DELETE_USE_POINT', targetIdentity, field);
  const deleteEffect = parseP014TraceCoreEvent(events, cursor, 'sessions.delete', targetIdentity, field, true);
  const maintenanceUsePointProbe = parseP014TraceStateEvent(events, cursor, 'MAINTENANCE_USE_POINT', targetIdentity, field);
  const maintenanceRecord = nextP014TraceEvent(
    events,
    cursor,
    P014_TRACE_EVENT_TYPES.MAINTENANCE,
    ['sequence', 'targetFingerprint', 'connectionId', 'callback'],
    field,
  );
  const maintenanceIdentity = {
    targetFingerprint: p014Id(maintenanceRecord.event.targetFingerprint, `${maintenanceRecord.field}.targetFingerprint`),
    connectionId: p014Id(maintenanceRecord.event.connectionId, `${maintenanceRecord.field}.connectionId`),
  };
  assertP014TraceIdentity(maintenanceIdentity, targetIdentity, maintenanceRecord.field);
  const callback = object(maintenanceRecord.event.callback, `${maintenanceRecord.field}.callback`);
  exactKeys(callback, ['executed', 'invocationCount', 'guarded'], [], `${maintenanceRecord.field}.callback`);
  const maintenance = {
    sequence: p014Sequence(maintenanceRecord.event.sequence, `${maintenanceRecord.field}.sequence`),
    targetFingerprint: maintenanceIdentity.targetFingerprint,
    connectionId: maintenanceIdentity.connectionId,
    usePointProbe: maintenanceUsePointProbe,
    callback: {
      executed: boolean(callback.executed, `${maintenanceRecord.field}.callback.executed`),
      invocationCount: positiveInteger(callback.invocationCount, `${maintenanceRecord.field}.callback.invocationCount`),
      guarded: boolean(callback.guarded, `${maintenanceRecord.field}.callback.guarded`),
    },
    coreRpcCalls: 0,
    effectCalls: 1,
  };
  const negativeProbes = [];
  const fixtureOwners = new Set();
  for (const id of REQUIRED_P014_NEGATIVE_PROBE_IDS) {
    const baselineRecord = events[cursor.index];
    check(baselineRecord !== undefined && baselineRecord !== null && typeof baselineRecord === 'object', 'P014_TRACE_EVENT_MISMATCH', field, `${field} is missing the ${id} baseline event`);
    const fixtureId = p014Id(baselineRecord.fixtureId, `${field}[${cursor.index}].fixtureId`);
    check(!fixtureOwners.has(fixtureId), 'DUPLICATE_ENTRY', `${field}[${cursor.index}].fixtureId`, 'P0-14 trace fixture ids must be unique');
    fixtureOwners.add(fixtureId);
    const expected = parseP014TraceNegativeSnapshot(events, cursor, P014_TRACE_EVENT_TYPES.NEGATIVE_BASELINE, id, fixtureId, field);
    const observed = parseP014TraceNegativeSnapshot(events, cursor, P014_TRACE_EVENT_TYPES.NEGATIVE_OBSERVED, id, fixtureId, field);
    const decisionRecord = nextP014TraceEvent(
      events,
      cursor,
      P014_TRACE_EVENT_TYPES.NEGATIVE_DECISION,
      ['id', 'fixtureId', 'identityMatch', 'rejected', 'rejectionCode', 'decisionSequence'],
      field,
    );
    check(string(decisionRecord.event.id, `${decisionRecord.field}.id`) === id, 'P014_TRACE_EVENT_MISMATCH', `${decisionRecord.field}.id`, `${decisionRecord.field} belongs to a different negative scenario`);
    check(p014Id(decisionRecord.event.fixtureId, `${decisionRecord.field}.fixtureId`) === fixtureId, 'P014_TRACE_IDENTITY_MISMATCH', `${decisionRecord.field}.fixtureId`, `${decisionRecord.field} belongs to a different fixture`);
    const identityMatch = boolean(decisionRecord.event.identityMatch, `${decisionRecord.field}.identityMatch`);
    check(identityMatch === (p014IdentityKey(expected.identity) === p014IdentityKey(observed.identity)), 'P014_TRACE_IDENTITY_MISMATCH', `${decisionRecord.field}.identityMatch`, `${decisionRecord.field} identity relationship is inconsistent`);
    negativeProbes.push({
      id,
      fixtureId,
      expected,
      observed,
      identityMatch,
      rejected: boolean(decisionRecord.event.rejected, `${decisionRecord.field}.rejected`),
      rejectionCode: string(decisionRecord.event.rejectionCode, `${decisionRecord.field}.rejectionCode`),
      decisionSequence: p014Sequence(decisionRecord.event.decisionSequence, `${decisionRecord.field}.decisionSequence`),
      coreRpcCalls: 0,
      effectCalls: 0,
    });
  }
  check(cursor.index === events.length, 'P014_TRACE_EVENT_MISMATCH', field, 'P0-14 trace contains unexpected trailing events');
  return {
    schemaVersion: P014_PROOF_SCHEMA_VERSION,
    target,
    capabilitiesProbe,
    absenceProbe,
    mutations: {
      reset: { ...resetEffect, usePointProbe: resetUsePointProbe },
      delete: { ...deleteEffect, usePointProbe: deleteUsePointProbe },
    },
    maintenance,
    negativeProbes,
  };
}

function validateP014FixtureSnapshot(value, field) {
  const snapshot = object(value, field);
  exactKeys(snapshot, ['sequence', 'identity', 'state'], [], field);
  const sequence = p014Sequence(snapshot.sequence, `${field}.sequence`);
  const identity = validateP014FixtureIdentity(snapshot.identity, `${field}.identity`);
  const state = object(snapshot.state, `${field}.state`);
  exactKeys(state, ['pluginSnapshot', 'durableState'], [], `${field}.state`);
  return {
    sequence,
    identity,
    identityKey: p014IdentityKey(identity),
    pluginSnapshot: p014Enum(
      state.pluginSnapshot,
      `${field}.state.pluginSnapshot`,
      P014_PLUGIN_SNAPSHOTS,
    ),
    durableState: p014Enum(
      state.durableState,
      `${field}.state.durableState`,
      P014_DURABLE_STATES,
    ),
  };
}

function p014Sequence(value, field) {
  return positiveInteger(value, field);
}

function assertP014Sequence(events, field) {
  let previous = 0;
  for (const [label, sequence] of events) {
    check(sequence > previous, 'P014_SEQUENCE_MISMATCH', `${field}.${label}.sequence`, `${field} sequences must be strictly increasing`);
    previous = sequence;
  }
}

function validateP014StateProbe(value, field, targetFingerprint, connectionId, expectedPluginSnapshot, expectedDurableState) {
  const probe = object(value, field);
  exactKeys(probe, [
    'sequence',
    'targetFingerprint',
    'connectionId',
    'pluginSnapshot',
    'durableState',
    'coreRpcCalls',
    'effectCalls',
    'passed',
  ], [], field);
  const sequence = p014Sequence(probe.sequence, `${field}.sequence`);
  p014Binding(probe, field, targetFingerprint, connectionId);
  check(
    p014Enum(probe.pluginSnapshot, `${field}.pluginSnapshot`, P014_PLUGIN_SNAPSHOTS) === expectedPluginSnapshot,
    'P014_STATE_MISMATCH',
    `${field}.pluginSnapshot`,
    `${field}.pluginSnapshot does not prove the required plugin state`,
  );
  check(
    p014Enum(probe.durableState, `${field}.durableState`, P014_DURABLE_STATES) === expectedDurableState,
    'P014_STATE_MISMATCH',
    `${field}.durableState`,
    `${field}.durableState does not prove the required durable state`,
  );
  p014RpcCount(probe.coreRpcCalls, `${field}.coreRpcCalls`, 0);
  p014RpcCount(probe.effectCalls, `${field}.effectCalls`, 0);
  check(boolean(probe.passed, `${field}.passed`) === true, 'P014_PROBE_FAILED', `${field}.passed`, `${field} did not pass`);
  return { ...probe, sequence };
}

function validateP014Mutation(value, field, targetFingerprint, connectionId, method, requiresDeleted) {
  const mutation = object(value, field);
  exactKeys(mutation, [
    'sequence',
    'method',
    'targetFingerprint',
    'connectionId',
    'requestedKey',
    'response',
    'usePointProbe',
    'coreRpcCalls',
    'effectCalls',
  ], [], field);
  const sequence = p014Sequence(mutation.sequence, `${field}.sequence`);
  check(string(mutation.method, `${field}.method`) === method, 'P014_METHOD_MISMATCH', `${field}.method`, `${field} used an unexpected core method`);
  p014Binding(mutation, field, targetFingerprint, connectionId);
  const requestedKey = p014Id(mutation.requestedKey, `${field}.requestedKey`);
  const response = object(mutation.response, `${field}.response`);
  exactKeys(response, requiresDeleted ? ['ok', 'key', 'deleted'] : ['ok', 'key'], [], `${field}.response`);
  check(boolean(response.ok, `${field}.response.ok`) === true, 'P014_MUTATION_FAILED', `${field}.response.ok`, `${field} did not return ok=true`);
  check(p014Id(response.key, `${field}.response.key`) === requestedKey, 'P014_IDENTITY_MISMATCH', `${field}.response.key`, `${field} response key differs from the requested session key`);
  if (requiresDeleted) {
    check(boolean(response.deleted, `${field}.response.deleted`) === true, 'P014_MUTATION_FAILED', `${field}.response.deleted`, `${field} did not return deleted=true`);
  }
  const usePointProbe = validateP014StateProbe(
    mutation.usePointProbe,
    `${field}.usePointProbe`,
    targetFingerprint,
    connectionId,
    'MISSING',
    'ABSENT',
  );
  check(usePointProbe.sequence < sequence, 'P014_SEQUENCE_MISMATCH', `${field}.usePointProbe.sequence`, `${field} use-point probe must precede its effect`);
  p014RpcCount(mutation.coreRpcCalls, `${field}.coreRpcCalls`, 1);
  p014RpcCount(mutation.effectCalls, `${field}.effectCalls`, 1);
  return { ...mutation, sequence, usePointProbe };
}

function validateP014Maintenance(value, field, targetFingerprint, connectionId) {
  const maintenance = object(value, field);
  exactKeys(maintenance, [
    'sequence',
    'targetFingerprint',
    'connectionId',
    'usePointProbe',
    'callback',
    'coreRpcCalls',
    'effectCalls',
  ], [], field);
  const sequence = p014Sequence(maintenance.sequence, `${field}.sequence`);
  p014Binding(maintenance, field, targetFingerprint, connectionId);
  const usePointProbe = validateP014StateProbe(
    maintenance.usePointProbe,
    `${field}.usePointProbe`,
    targetFingerprint,
    connectionId,
    'MISSING',
    'ABSENT',
  );
  check(usePointProbe.sequence < sequence, 'P014_SEQUENCE_MISMATCH', `${field}.usePointProbe.sequence`, `${field} use-point probe must precede its effect`);
  const callback = object(maintenance.callback, `${field}.callback`);
  exactKeys(callback, ['executed', 'invocationCount', 'guarded'], [], `${field}.callback`);
  check(boolean(callback.executed, `${field}.callback.executed`) === true, 'P014_MAINTENANCE_FAILED', `${field}.callback.executed`, 'Maintenance callback did not execute');
  check(positiveInteger(callback.invocationCount, `${field}.callback.invocationCount`) === 1, 'P014_MAINTENANCE_FAILED', `${field}.callback.invocationCount`, 'Maintenance callback must execute exactly once');
  check(boolean(callback.guarded, `${field}.callback.guarded`) === false, 'P014_MAINTENANCE_GUARDED', `${field}.callback.guarded`, 'P0-14 requires the attested maintenance callback to be unguarded');
  p014RpcCount(maintenance.coreRpcCalls, `${field}.coreRpcCalls`, 0);
  p014RpcCount(maintenance.effectCalls, `${field}.effectCalls`, 1);
  return { ...maintenance, sequence, usePointProbe };
}

function validateP014CapabilitiesProbe(value, field, targetFingerprint, connectionId) {
  const probe = object(value, field);
  exactKeys(probe, [
    'sequence',
    'targetFingerprint',
    'connectionId',
    'method',
    'error',
    'coreRpcCalls',
    'effectCalls',
    'passed',
  ], [], field);
  const sequence = p014Sequence(probe.sequence, `${field}.sequence`);
  p014Binding(probe, field, targetFingerprint, connectionId);
  check(string(probe.method, `${field}.method`) === 'junqi.collab.capabilities', 'P014_METHOD_MISMATCH', `${field}.method`, 'P0-14 must probe the collaboration capabilities method');
  const error = object(probe.error, `${field}.error`);
  exactKeys(error, ['code', 'classification', 'exact'], [], `${field}.error`);
  check(string(error.code, `${field}.error.code`) === 'INVALID_REQUEST', 'P014_CAPABILITIES_CLASSIFICATION', `${field}.error.code`, 'Missing capabilities must return INVALID_REQUEST');
  check(string(error.classification, `${field}.error.classification`) === 'METHOD_NOT_FOUND', 'P014_CAPABILITIES_CLASSIFICATION', `${field}.error.classification`, 'Missing capabilities must be classified as METHOD_NOT_FOUND');
  check(boolean(error.exact, `${field}.error.exact`) === true, 'P014_CAPABILITIES_CLASSIFICATION', `${field}.error.exact`, 'Capabilities absence classification must be exact');
  p014RpcCount(probe.coreRpcCalls, `${field}.coreRpcCalls`, 1);
  p014RpcCount(probe.effectCalls, `${field}.effectCalls`, 0);
  check(boolean(probe.passed, `${field}.passed`) === true, 'P014_PROBE_FAILED', `${field}.passed`, `${field} did not pass`);
  return { ...probe, sequence };
}

function validateP014Proof(value, field = 'gateway.cases.P0-14.p014', caseArtifacts = undefined) {
  const proof = object(value, field);
  exactKeys(proof, [
    'schemaVersion',
    'target',
    'capabilitiesProbe',
    'absenceProbe',
    'mutations',
    'maintenance',
    'negativeProbes',
    'traceArtifact',
  ], [], field);
  check(proof.schemaVersion === P014_PROOF_SCHEMA_VERSION, 'P014_SCHEMA_MISMATCH', `${field}.schemaVersion`, 'Unsupported P0-14 proof schema');

  const target = object(proof.target, `${field}.target`);
  exactKeys(target, [
    'targetFingerprint',
    'connectionId',
    'deploymentKind',
    'pluginSnapshot',
    'durableState',
  ], [], `${field}.target`);
  const targetFingerprint = p014Id(target.targetFingerprint, `${field}.target.targetFingerprint`);
  const connectionId = p014Id(target.connectionId, `${field}.target.connectionId`);
  check(string(target.deploymentKind, `${field}.target.deploymentKind`) === 'EPHEMERAL_CONTAINER', 'P014_STATE_MISMATCH', `${field}.target.deploymentKind`, 'P0-14 must run against the pinned disposable Gateway runtime');
  check(p014Enum(target.pluginSnapshot, `${field}.target.pluginSnapshot`, P014_PLUGIN_SNAPSHOTS) === 'MISSING', 'P014_STATE_MISMATCH', `${field}.target.pluginSnapshot`, 'P0-14 requires a no-plugin target');
  check(p014Enum(target.durableState, `${field}.target.durableState`, P014_DURABLE_STATES) === 'ABSENT', 'P014_STATE_MISMATCH', `${field}.target.durableState`, 'P0-14 requires durable collaboration state to be ABSENT');

  const capabilitiesProbe = validateP014CapabilitiesProbe(
    proof.capabilitiesProbe,
    `${field}.capabilitiesProbe`,
    targetFingerprint,
    connectionId,
  );

  const absenceProbe = validateP014StateProbe(
    proof.absenceProbe,
    `${field}.absenceProbe`,
    targetFingerprint,
    connectionId,
    'MISSING',
    'ABSENT',
  );

  const mutations = object(proof.mutations, `${field}.mutations`);
  exactKeys(mutations, ['reset', 'delete'], [], `${field}.mutations`);
  const reset = validateP014Mutation(mutations.reset, `${field}.mutations.reset`, targetFingerprint, connectionId, 'sessions.reset', false);
  const deletion = validateP014Mutation(mutations.delete, `${field}.mutations.delete`, targetFingerprint, connectionId, 'sessions.delete', true);
  const maintenance = validateP014Maintenance(proof.maintenance, `${field}.maintenance`, targetFingerprint, connectionId);
  assertP014Sequence([
    ['capabilitiesProbe', capabilitiesProbe.sequence],
    ['absenceProbe', absenceProbe.sequence],
    ['mutations.reset.usePointProbe', reset.usePointProbe.sequence],
    ['mutations.reset', reset.sequence],
    ['mutations.delete.usePointProbe', deletion.usePointProbe.sequence],
    ['mutations.delete', deletion.sequence],
    ['maintenance.usePointProbe', maintenance.usePointProbe.sequence],
    ['maintenance', maintenance.sequence],
  ], field);

  const negativeProbes = array(
    proof.negativeProbes,
    `${field}.negativeProbes`,
    REQUIRED_P014_NEGATIVE_PROBE_IDS.length,
  ).map((entry, index) => {
    const probeField = `${field}.negativeProbes[${index}]`;
    const probe = object(entry, probeField);
    exactKeys(probe, [
      'id',
      'fixtureId',
      'expected',
      'observed',
      'identityMatch',
      'rejected',
      'rejectionCode',
      'decisionSequence',
      'coreRpcCalls',
      'effectCalls',
    ], [], probeField);
    const id = string(probe.id, `${probeField}.id`);
    check(REQUIRED_P014_NEGATIVE_PROBE_IDS.includes(id), 'UNKNOWN_ENTRY', `${probeField}.id`, `${probeField} is not a required P0-14 negative probe`);
    const fixtureId = p014Id(probe.fixtureId, `${probeField}.fixtureId`);
    const expected = validateP014FixtureSnapshot(probe.expected, `${probeField}.expected`);
    const observed = validateP014FixtureSnapshot(probe.observed, `${probeField}.observed`);
    const decisionSequence = p014Sequence(probe.decisionSequence, `${probeField}.decisionSequence`);
    const requirement = P014_NEGATIVE_PROBE_REQUIREMENTS[id];

    check(
      expected.sequence < observed.sequence && observed.sequence < decisionSequence,
      'P014_SEQUENCE_MISMATCH',
      probeField,
      `${probeField} must order baseline, use-point observation, and rejection decision`,
    );

    check(
      expected.pluginSnapshot === 'MISSING' && expected.durableState === 'ABSENT',
      'P014_STATE_MISMATCH',
      `${probeField}.expected.state`,
      `${probeField} must start from an independently provisioned no-plugin, no-durable-state fixture`,
    );
    check(
      observed.pluginSnapshot === requirement.observedPluginSnapshot
        && observed.durableState === requirement.observedDurableState,
      'P014_STATE_MISMATCH',
      `${probeField}.observed.state`,
      `${probeField} did not observe the required negative state`,
    );

    const identityMatch = boolean(probe.identityMatch, `${probeField}.identityMatch`);
    const computedIdentityMatch = expected.identityKey === observed.identityKey;
    check(
      identityMatch === computedIdentityMatch,
      'P014_IDENTITY_MISMATCH',
      `${probeField}.identityMatch`,
      `${probeField}.identityMatch does not match its expected and observed identities`,
    );
    check(
      identityMatch === requirement.identityMatch,
      'P014_IDENTITY_MISMATCH',
      `${probeField}.identityMatch`,
      `${probeField} has the wrong identity relationship for this negative scenario`,
    );
    check(
      boolean(probe.rejected, `${probeField}.rejected`) === true,
      'P014_REJECTION_MISMATCH',
      `${probeField}.rejected`,
      `${probeField} must prove that the guarded action was rejected`,
    );
    check(
      string(probe.rejectionCode, `${probeField}.rejectionCode`) === requirement.rejectionCode,
      'P014_REJECTION_MISMATCH',
      `${probeField}.rejectionCode`,
      `${probeField} returned an unexpected rejection code`,
    );
    p014RpcCount(probe.coreRpcCalls, `${probeField}.coreRpcCalls`, 0);
    p014RpcCount(probe.effectCalls, `${probeField}.effectCalls`, 0);
    return { ...probe, id, fixtureId, expected, observed, decisionSequence };
  });
  exactSet(negativeProbes, REQUIRED_P014_NEGATIVE_PROBE_IDS, `${field}.negativeProbes`);

  const fixtureIds = negativeProbes.map((probe) => probe.fixtureId);
  check(
    new Set(fixtureIds).size === fixtureIds.length,
    'DUPLICATE_ENTRY',
    `${field}.negativeProbes`,
    'Every P0-14 negative scenario must use a unique fixtureId',
  );

  const positiveIdentityKey = p014IdentityKey({ targetFingerprint, connectionId });
  const expectedIdentityOwners = new Map();
  const expectedTargetOwners = new Map();
  for (const probe of negativeProbes) {
    check(
      probe.expected.identityKey !== positiveIdentityKey,
      'P014_IDENTITY_MISMATCH',
      `${field}.negativeProbes`,
      'A negative fixture must not reuse the positive no-plugin trace identity',
    );
    check(
      probe.expected.identity.targetFingerprint !== targetFingerprint,
      'P014_IDENTITY_MISMATCH',
      `${field}.negativeProbes`,
      'A negative fixture must not reuse the positive no-plugin target',
    );
    check(
      !expectedIdentityOwners.has(probe.expected.identityKey),
      'DUPLICATE_ENTRY',
      `${field}.negativeProbes`,
      'Every P0-14 negative fixture must have a unique expected target and connection',
    );
    expectedIdentityOwners.set(probe.expected.identityKey, probe.id);
    check(
      !expectedTargetOwners.has(probe.expected.identity.targetFingerprint),
      'DUPLICATE_ENTRY',
      `${field}.negativeProbes`,
      'Every P0-14 negative fixture must use an independently provisioned target',
    );
    expectedTargetOwners.set(probe.expected.identity.targetFingerprint, probe.id);
  }

  const mismatchObservationOwners = new Map();
  for (const probe of negativeProbes) {
    check(
      probe.observed.identityKey !== positiveIdentityKey,
      'P014_IDENTITY_MISMATCH',
      `${field}.negativeProbes`,
      'A negative fixture observation must not reuse the positive no-plugin trace identity',
    );
    check(
      probe.observed.identity.targetFingerprint !== targetFingerprint,
      'P014_IDENTITY_MISMATCH',
      `${field}.negativeProbes`,
      'A negative fixture observation must not reuse the positive no-plugin target',
    );
    if (probe.observed.identityKey === probe.expected.identityKey) continue;
    check(
      !expectedIdentityOwners.has(probe.observed.identityKey),
      'P014_IDENTITY_MISMATCH',
      `${field}.negativeProbes`,
      'A negative fixture observation must not be cross-bound to another fixture identity',
    );
    check(
      !expectedTargetOwners.has(probe.observed.identity.targetFingerprint),
      'P014_IDENTITY_MISMATCH',
      `${field}.negativeProbes`,
      'A negative fixture observation must not be cross-bound to another fixture target',
    );
    check(
      !mismatchObservationOwners.has(probe.observed.identityKey),
      'DUPLICATE_ENTRY',
      `${field}.negativeProbes`,
      'Mismatched negative fixture observations must use unique identities',
    );
    mismatchObservationOwners.set(probe.observed.identityKey, probe.id);
  }
  const traceArtifact = validateP014TraceArtifactMetadata(
    proof.traceArtifact,
    `${field}.traceArtifact`,
    caseArtifacts,
  );
  check(
    traceArtifact.claimsSha256 === p014TraceClaimsSha256(proof),
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.traceArtifact.claimsSha256`,
    'P0-14 trace claims digest does not bind the complete proof',
  );
  return proof;
}

function validateGatewayEvidence(value, expected, producer, releaseRef, nowMs) {
  const artifactRegistry = new ArtifactReferenceRegistry('gateway.artifacts');
  const { evidence, startedAt: evidenceStartedAt, completedAt } = validateBase(
    value,
    'GATEWAY',
    expected,
    producer,
    releaseRef,
    nowMs,
    ['scope', 'p0BehaviorVerified', 'capabilitiesOnly', 'structuralOnly', 'runtime', 'cases'],
  );
  check(evidence.scope === 'FULL_BEHAVIORAL', 'SCOPE_MISMATCH', 'gateway.scope', 'Gateway evidence must cover full behavior');
  check(boolean(evidence.p0BehaviorVerified, 'gateway.p0BehaviorVerified') === true, 'SCOPE_MISMATCH', 'gateway.p0BehaviorVerified', 'Gateway P0 behavior was not verified');
  check(boolean(evidence.capabilitiesOnly, 'gateway.capabilitiesOnly') === false, 'SCOPE_MISMATCH', 'gateway.capabilitiesOnly', 'Capabilities-only evidence is insufficient');
  check(boolean(evidence.structuralOnly, 'gateway.structuralOnly') === false, 'SCOPE_MISMATCH', 'gateway.structuralOnly', 'Structural-only evidence is insufficient');

  const runtime = object(evidence.runtime, 'gateway.runtime');
  exactKeys(runtime, [
    'openclawVersion',
    'imageDigest',
    'environmentKind',
    'devMode',
    'defaultProfileMounted',
    'disposable',
    'isolation',
  ], [], 'gateway.runtime');
  check(runtime.openclawVersion === OFFICIAL_OPENCLAW_VERSION, 'RUNTIME_MISMATCH', 'gateway.runtime.openclawVersion', 'Gateway evidence used the wrong OpenClaw version');
  check(runtime.imageDigest === OFFICIAL_OPENCLAW_IMAGE_DIGEST, 'RUNTIME_MISMATCH', 'gateway.runtime.imageDigest', 'Gateway evidence used an unreviewed image digest');
  check(runtime.environmentKind === 'EPHEMERAL_CONTAINER', 'ISOLATION_MISMATCH', 'gateway.runtime.environmentKind', 'Gateway evidence must use an ephemeral container');
  check(boolean(runtime.devMode, 'gateway.runtime.devMode') === false, 'ISOLATION_MISMATCH', 'gateway.runtime.devMode', 'Gateway evidence must not use dev mode');
  check(boolean(runtime.defaultProfileMounted, 'gateway.runtime.defaultProfileMounted') === false, 'ISOLATION_MISMATCH', 'gateway.runtime.defaultProfileMounted', 'Gateway evidence must not mount the default profile');
  check(boolean(runtime.disposable, 'gateway.runtime.disposable') === true, 'ISOLATION_MISMATCH', 'gateway.runtime.disposable', 'Gateway environment must be disposable');
  const isolation = object(runtime.isolation, 'gateway.runtime.isolation');
  exactKeys(isolation, ['home', 'xdgConfig', 'xdgCache', 'xdgData', 'xdgState', 'tmp'], [], 'gateway.runtime.isolation');
  for (const key of Object.keys(isolation)) {
    check(boolean(isolation[key], `gateway.runtime.isolation.${key}`) === true, 'ISOLATION_MISMATCH', `gateway.runtime.isolation.${key}`, `Gateway ${key} was not isolated`);
  }

  const cases = array(evidence.cases, 'gateway.cases', 32).map((entry, index) => {
    const field = `gateway.cases[${index}]`;
    const testCase = object(entry, field);
    rejectSkipMarkers(testCase, field);
    const caseId = string(testCase.id, `${field}.id`);
    exactKeys(testCase, [
      'id',
      'status',
      'startedAt',
      'endedAt',
      'identities',
      'artifacts',
      ...(caseId === 'P0-14' ? ['p014'] : []),
    ], [], field);
    pass(testCase, field);
    const caseStartedAt = instant(testCase.startedAt, `${field}.startedAt`);
    const endedAt = instant(testCase.endedAt, `${field}.endedAt`);
    check(caseStartedAt >= evidenceStartedAt, 'INVALID_DURATION', `${field}.startedAt`, 'Gateway case started before the evidence run');
    check(endedAt >= caseStartedAt, 'INVALID_DURATION', field, 'Gateway case ended before it started');
    check(endedAt <= completedAt, 'INVALID_DURATION', `${field}.endedAt`, 'Gateway case ended after evidence completion');
    const identities = object(testCase.identities, `${field}.identities`);
    const identityKeys = ['rpcMethods', 'taskIds', 'agentRunIds', 'sessionIds', 'messageIds', 'flowIds'];
    exactKeys(identities, identityKeys, [], `${field}.identities`);
    const observed = identityKeys.flatMap((key) => validateUniqueStrings(identities[key], `${field}.identities.${key}`));
    check(observed.length > 0, 'MISSING_OBSERVATION', `${field}.identities`, 'Gateway case must contain observed runtime identities');
    const caseArtifacts = validateArtifacts(testCase.artifacts, `${field}.artifacts`, ['OBSERVATION'], artifactRegistry);
    if (caseId === 'P0-14') validateP014Proof(testCase.p014, `${field}.p014`, caseArtifacts);
    return testCase;
  });
  exactSet(cases, REQUIRED_P0_CASE_IDS, 'gateway.cases');
  check(
    artifactRegistry.values().filter((reference) => reference.kind === P014_TRACE_ARTIFACT_KIND).length === 1,
    'P014_TRACE_ARTIFACT_MISMATCH',
    'gateway.cases',
    'Gateway evidence must contain exactly one P0-14 physical trace reference',
  );
  return artifactRegistry.values();
}

function validateVisualEvidence(value, expected, producer, releaseRef, nowMs) {
  const artifactRegistry = new ArtifactReferenceRegistry('visual.artifacts');
  const { evidence, startedAt: evidenceStartedAt, completedAt } = validateBase(
    value,
    'VISUAL',
    expected,
    producer,
    releaseRef,
    nowMs,
    ['candidate', 'environment', 'observations'],
  );
  const candidate = object(evidence.candidate, 'visual.candidate');
  exactKeys(candidate, ['desktopVersion', 'platform', 'artifactName', 'artifactSha256'], [], 'visual.candidate');
  check(candidate.desktopVersion === expected.desktopVersion, 'SUBJECT_MISMATCH', 'visual.candidate.desktopVersion', 'Visual candidate desktop version differs');
  const candidateAsset = validateVisualCandidateAsset(
    candidate.platform,
    candidate.artifactName,
    candidate.artifactSha256,
    'visual.candidate',
  );
  const environment = object(evidence.environment, 'visual.environment');
  exactKeys(environment, ['browserName', 'browserVersion', 'osName', 'osVersion'], [], 'visual.environment');
  for (const key of Object.keys(environment)) string(environment[key], `visual.environment.${key}`);

  const requiredPairs = REQUIRED_VISUAL_SCENARIOS.flatMap((scenarioId) => (
    REQUIRED_VISUAL_VIEWPORTS.map((viewport) => `${scenarioId}\0${viewport.id}`)
  ));
  const observations = array(evidence.observations, 'visual.observations', 128).map((entry, index) => {
    const field = `visual.observations[${index}]`;
    const observation = object(entry, field);
    rejectSkipMarkers(observation, field);
    exactKeys(observation, [
      'scenarioId',
      'viewport',
      'status',
      'startedAt',
      'endedAt',
      'assertions',
      'artifacts',
      'consoleErrors',
      'pageErrors',
      'failedRequests',
    ], [], field);
    pass(observation, field);
    const observationStartedAt = instant(observation.startedAt, `${field}.startedAt`);
    const endedAt = instant(observation.endedAt, `${field}.endedAt`);
    check(observationStartedAt >= evidenceStartedAt, 'INVALID_DURATION', `${field}.startedAt`, 'Visual observation started before the evidence run');
    check(endedAt >= observationStartedAt && endedAt <= completedAt, 'INVALID_DURATION', `${field}.endedAt`, 'Visual observation falls outside the evidence run');
    const scenarioId = string(observation.scenarioId, `${field}.scenarioId`);
    const viewport = object(observation.viewport, `${field}.viewport`);
    exactKeys(viewport, ['id', 'width', 'height', 'deviceScaleFactor'], [], `${field}.viewport`);
    const viewportId = string(viewport.id, `${field}.viewport.id`);
    const expectedViewport = REQUIRED_VISUAL_VIEWPORTS.find((entry) => entry.id === viewportId);
    check(expectedViewport !== undefined, 'UNKNOWN_ENTRY', `${field}.viewport.id`, 'Visual observation uses an unknown viewport');
    check(viewport.width === expectedViewport.width, 'VIEWPORT_MISMATCH', `${field}.viewport.width`, 'Visual viewport width differs from policy');
    check(viewport.height === expectedViewport.height, 'VIEWPORT_MISMATCH', `${field}.viewport.height`, 'Visual viewport height differs from policy');
    positiveNumber(viewport.deviceScaleFactor, `${field}.viewport.deviceScaleFactor`);
    const assertions = array(observation.assertions, `${field}.assertions`, 32).map((entry, assertionIndex) => {
      const assertionField = `${field}.assertions[${assertionIndex}]`;
      const assertion = object(entry, assertionField);
      rejectSkipMarkers(assertion, assertionField);
      exactKeys(assertion, ['id', 'status'], [], assertionField);
      pass(assertion, assertionField);
      return assertion;
    });
    exactSet(assertions, REQUIRED_VISUAL_ASSERTIONS[scenarioId] ?? [], `${field}.assertions`);
    validateArtifacts(
      observation.artifacts,
      `${field}.artifacts`,
      ['SCREENSHOT', 'INTERACTION_TRACE'],
      artifactRegistry,
    );
    for (const errorField of ['consoleErrors', 'pageErrors', 'failedRequests']) {
      check(array(observation[errorField], `${field}.${errorField}`, 64).length === 0, 'BROWSER_ERROR', `${field}.${errorField}`, `${field}.${errorField} must be empty`);
    }
    return { ...observation, pairId: `${scenarioId}\0${viewportId}` };
  });
  exactSet(observations, requiredPairs, 'visual.observations', (entry) => entry.pairId);
  const artifactReferences = artifactRegistry.values();
  const candidateReferences = artifactReferences.filter((reference) => reference.kind === 'CANDIDATE_INSTALLER');
  check(candidateReferences.length === 1, 'MISSING_ARTIFACT', 'visual.observations', 'Visual evidence requires exactly one physical candidate installer');
  check(
    candidateReferences[0].name === candidateAsset.artifactName
      && candidateReferences[0].sha256 === candidateAsset.artifactSha256,
    'SUBJECT_MISMATCH',
    'visual.candidate',
    'Visual candidate identity differs from its referenced physical installer',
  );
  return { artifactReferences, candidate: candidateAsset };
}

function validateObservedInvariant(invariant, field) {
  const observed = object(invariant.observed, `${field}.observed`);
  if (invariant.id === 'database-integrity') {
    exactKeys(observed, ['value'], [], `${field}.observed`);
    check(observed.value === 'ok', 'INVARIANT_FAILED', `${field}.observed.value`, 'Database integrity is not ok');
    return;
  }
  if (invariant.id === 'bounded-resource-growth') {
    exactKeys(observed, ['rssGrowthBytes', 'fdGrowth'], [], `${field}.observed`);
    const rssGrowth = positiveInteger(observed.rssGrowthBytes, `${field}.observed.rssGrowthBytes`, true);
    const fdGrowth = positiveInteger(observed.fdGrowth, `${field}.observed.fdGrowth`, true);
    check(rssGrowth <= MAX_RSS_GROWTH_BYTES, 'INVARIANT_FAILED', `${field}.observed.rssGrowthBytes`, 'RSS growth exceeds policy');
    check(fdGrowth <= MAX_FD_GROWTH, 'INVARIANT_FAILED', `${field}.observed.fdGrowth`, 'File descriptor growth exceeds policy');
    return;
  }
  exactKeys(observed, ['count'], [], `${field}.observed`);
  check(positiveInteger(observed.count, `${field}.observed.count`, true) === 0, 'INVARIANT_FAILED', `${field}.observed.count`, `${invariant.id} observed a violation`);
}

function validateSoakEvidence(value, expected, producer, releaseRef, nowMs) {
  const artifactRegistry = new ArtifactReferenceRegistry('soak.artifacts');
  const { evidence, startedAt: wallStartedAt, completedAt: wallCompletedAt } = validateBase(
    value,
    'SOAK',
    expected,
    producer,
    releaseRef,
    nowMs,
    ['seed', 'heartbeatIntervalMs', 'heartbeats', 'clock', 'faults', 'finalInvariants', 'artifacts'],
  );
  string(evidence.seed, 'soak.seed', /^[A-Za-z0-9_.:-]{8,128}$/);
  check(evidence.heartbeatIntervalMs === SOAK_HEARTBEAT_INTERVAL_MS, 'HEARTBEAT_MISMATCH', 'soak.heartbeatIntervalMs', 'Soak heartbeat interval differs from policy');
  const clock = object(evidence.clock, 'soak.clock');
  exactKeys(clock, ['source', 'startedMs', 'endedMs', 'durationMs'], [], 'soak.clock');
  check(clock.source === 'MONOTONIC', 'CLOCK_MISMATCH', 'soak.clock.source', 'Soak duration must use a monotonic clock');
  const startedMs = positiveInteger(clock.startedMs, 'soak.clock.startedMs', true);
  const endedMs = positiveInteger(clock.endedMs, 'soak.clock.endedMs');
  const durationMs = positiveInteger(clock.durationMs, 'soak.clock.durationMs');
  check(endedMs > startedMs, 'INVALID_DURATION', 'soak.clock', 'Soak monotonic clock did not advance');
  check(endedMs - startedMs === durationMs, 'INVALID_DURATION', 'soak.clock.durationMs', 'Soak duration does not match monotonic endpoints');
  check(durationMs >= MIN_SOAK_DURATION_MS, 'SOAK_TOO_SHORT', 'soak.clock.durationMs', 'Soak duration is below the policy minimum');
  const wallDuration = wallCompletedAt - wallStartedAt;
  check(Math.abs(wallDuration - durationMs) <= MAX_SOAK_WALL_CLOCK_DRIFT_MS, 'CLOCK_MISMATCH', 'soak.clock.durationMs', 'Soak monotonic and wall-clock durations diverge');

  const heartbeats = array(evidence.heartbeats, 'soak.heartbeats', 4096).map((entry, index) => positiveInteger(entry, `soak.heartbeats[${index}]`, true));
  check(heartbeats.length > 1, 'HEARTBEAT_MISSING', 'soak.heartbeats', 'Soak requires repeated heartbeats');
  for (let index = 0; index < heartbeats.length; index += 1) {
    check(
      heartbeats[index] >= startedMs && heartbeats[index] <= endedMs,
      'HEARTBEAT_MISMATCH',
      `soak.heartbeats[${index}]`,
      'Soak heartbeat falls outside the monotonic test interval',
    );
  }
  check(heartbeats[0] - startedMs <= SOAK_HEARTBEAT_INTERVAL_MS, 'HEARTBEAT_MISSING', 'soak.heartbeats[0]', 'Initial soak heartbeat is missing');
  check(endedMs - heartbeats.at(-1) <= SOAK_HEARTBEAT_INTERVAL_MS, 'HEARTBEAT_MISSING', 'soak.heartbeats', 'Final soak heartbeat is missing');
  for (let index = 1; index < heartbeats.length; index += 1) {
    const gap = heartbeats[index] - heartbeats[index - 1];
    check(gap > 0 && gap <= SOAK_HEARTBEAT_INTERVAL_MS * 2, 'HEARTBEAT_MISSING', `soak.heartbeats[${index}]`, 'Soak heartbeat sequence has a gap');
  }

  const faults = array(evidence.faults, 'soak.faults', 32).map((entry, index) => {
    const field = `soak.faults[${index}]`;
    const fault = object(entry, field);
    rejectSkipMarkers(fault, field);
    exactKeys(fault, ['id', 'status', 'plannedInjections', 'events'], [], field);
    pass(fault, field);
    const plannedInjections = positiveInteger(fault.plannedInjections, `${field}.plannedInjections`);
    const events = array(fault.events, `${field}.events`, 128).map((eventValue, eventIndex) => {
      const eventField = `${field}.events[${eventIndex}]`;
      const event = object(eventValue, eventField);
      rejectSkipMarkers(event, eventField);
      exactKeys(event, ['sequence', 'status', 'injectedAtMs', 'recoveredAtMs', 'artifacts'], [], eventField);
      pass(event, eventField);
      check(event.sequence === eventIndex + 1, 'SEQUENCE_MISMATCH', `${eventField}.sequence`, 'Fault event sequence is not contiguous');
      const injectedAtMs = positiveInteger(event.injectedAtMs, `${eventField}.injectedAtMs`, true);
      const recoveredAtMs = positiveInteger(event.recoveredAtMs, `${eventField}.recoveredAtMs`);
      check(injectedAtMs >= startedMs && recoveredAtMs <= endedMs, 'INVALID_DURATION', eventField, 'Fault event falls outside the soak interval');
      check(recoveredAtMs > injectedAtMs, 'RECOVERY_MISMATCH', `${eventField}.recoveredAtMs`, 'Fault recovery must follow injection');
      if (eventIndex > 0) {
        check(injectedAtMs >= fault.events[eventIndex - 1].recoveredAtMs, 'SEQUENCE_MISMATCH', `${eventField}.injectedAtMs`, 'Fault events overlap or are out of order');
      }
      validateArtifacts(event.artifacts, `${eventField}.artifacts`, ['OBSERVATION'], artifactRegistry);
      return event;
    });
    check(events.length === plannedInjections, 'MISSING_ENTRY', `${field}.events`, 'Fault events do not match the planned injections');
    return fault;
  });
  exactSet(faults, REQUIRED_SOAK_FAULT_IDS, 'soak.faults');

  const finalInvariants = array(evidence.finalInvariants, 'soak.finalInvariants', 32).map((entry, index) => {
    const field = `soak.finalInvariants[${index}]`;
    const invariant = object(entry, field);
    rejectSkipMarkers(invariant, field);
    exactKeys(invariant, ['id', 'status', 'observed', 'artifactSha256'], [], field);
    pass(invariant, field);
    validateObservedInvariant(invariant, field);
    const artifactDigest = sha(invariant.artifactSha256, `${field}.artifactSha256`);
    return { ...invariant, artifactDigest };
  });
  exactSet(finalInvariants, REQUIRED_SOAK_INVARIANT_IDS, 'soak.finalInvariants');
  validateArtifacts(evidence.artifacts, 'soak.artifacts', ['LOG', 'METRICS'], artifactRegistry);
  for (const [index, invariant] of finalInvariants.entries()) {
    check(
      artifactRegistry.hasDigest(invariant.artifactDigest),
      'MISSING_ARTIFACT',
      `soak.finalInvariants[${index}].artifactSha256`,
      'Soak invariant digest must identify a referenced physical artifact',
    );
  }
  return artifactRegistry.values();
}

export function assessExternalReleaseEvidence(input) {
  try {
    const value = object(input, 'input');
    exactKeys(value, ['quality', 'gateway', 'visual', 'soak', 'producers', 'releaseRef', 'nowMs'], [], 'input');
    const producers = object(value.producers, 'producers');
    exactKeys(producers, ['gateway', 'visual', 'soak'], [], 'producers');
    const normalizedProducers = Object.fromEntries(
      Object.entries(producers).map(([kind, producerValue]) => {
        const field = `producers.${kind}`;
        const producer = object(producerValue, field);
        exactKeys(producer, ['runId', 'runAttempt'], [], field);
        return [kind, {
          runId: runId(producer.runId, `${field}.runId`),
          runAttempt: positiveInteger(producer.runAttempt, `${field}.runAttempt`),
        }];
      }),
    );
    const gatewayRunId = normalizedProducers.gateway.runId;
    const visualRunId = normalizedProducers.visual.runId;
    const soakRunId = normalizedProducers.soak.runId;
    check(new Set([gatewayRunId, visualRunId, soakRunId]).size === 3, 'DUPLICATE_RUN', 'runIds', 'Gateway, visual, and soak evidence must come from distinct workflow runs');
    check(Number.isSafeInteger(value.nowMs) && value.nowMs > 0, 'INVALID_VALUE', 'nowMs', 'nowMs must be a positive safe integer');
    const releaseRef = string(value.releaseRef, 'releaseRef', /^refs\/tags\/v[0-9A-Za-z][0-9A-Za-z._-]*$/);

    const expected = validateQualityEvidence(value.quality);
    const visualEvidence = validateVisualEvidence(
      value.visual,
      expected,
      normalizedProducers.visual,
      releaseRef,
      value.nowMs,
    );
    const artifactReferences = {
      gateway: validateGatewayEvidence(value.gateway, expected, normalizedProducers.gateway, releaseRef, value.nowMs),
      visual: visualEvidence.artifactReferences,
      soak: validateSoakEvidence(value.soak, expected, normalizedProducers.soak, releaseRef, value.nowMs),
    };

    return {
      kind: 'SATISFIED',
      policyVersion: EXTERNAL_RELEASE_POLICY_VERSION,
      testPlanSha256: EXTERNAL_RELEASE_TEST_PLAN_SHA256,
      subject: {
        repo: expected.repo,
        commit: expected.commit,
        tree: expected.tree,
        bundleSha256: expected.bundleSha256,
        pluginVersion: expected.pluginVersion,
        schemaVersion: expected.schemaVersion,
      },
      releaseRef,
      workflowRuns: normalizedProducers,
      artifactReferences,
      visualCandidate: visualEvidence.candidate,
    };
  } catch (error) {
    const failure = error instanceof ExternalEvidenceValidationError
      ? error
      : new ExternalEvidenceValidationError('INVALID_EVIDENCE', 'input', error instanceof Error ? error.message : String(error));
    return {
      kind: 'BLOCKED',
      code: failure.code,
      field: failure.field,
      message: failure.message,
    };
  }
}

function strictJsonScanner(source, field) {
  let cursor = 0;

  const invalid = (message) => reject('INVALID_JSON', field, `${field} is not valid JSON: ${message}`);
  const skipWhitespace = () => {
    while (cursor < source.length && /[\u0009\u000a\u000d\u0020]/.test(source[cursor])) cursor += 1;
  };
  const parseString = () => {
    if (source[cursor] !== '"') invalid(`expected a string at byte ${cursor}`);
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === '"') {
        cursor += 1;
        try {
          return JSON.parse(source.slice(start, cursor));
        } catch (error) {
          invalid(error instanceof Error ? error.message : String(error));
        }
      }
      if (character === '\\') {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    invalid('unterminated string');
  };

  const parseValue = (depth) => {
    if (depth > 128) invalid('maximum nesting depth exceeded');
    skipWhitespace();
    if (cursor >= source.length) invalid('unexpected end of input');
    if (source[cursor] === '"') {
      parseString();
      return;
    }
    if (source[cursor] === '{') {
      cursor += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[cursor] === '}') {
        cursor += 1;
        return;
      }
      while (cursor < source.length) {
        skipWhitespace();
        const key = parseString();
        check(!keys.has(key), 'DUPLICATE_JSON_KEY', field, `${field} contains duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (source[cursor] !== ':') invalid(`expected ':' at byte ${cursor}`);
        cursor += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (source[cursor] === '}') {
          cursor += 1;
          return;
        }
        if (source[cursor] !== ',') invalid(`expected ',' or '}' at byte ${cursor}`);
        cursor += 1;
      }
      invalid('unterminated object');
    }
    if (source[cursor] === '[') {
      cursor += 1;
      skipWhitespace();
      if (source[cursor] === ']') {
        cursor += 1;
        return;
      }
      while (cursor < source.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (source[cursor] === ']') {
          cursor += 1;
          return;
        }
        if (source[cursor] !== ',') invalid(`expected ',' or ']' at byte ${cursor}`);
        cursor += 1;
      }
      invalid('unterminated array');
    }
    const start = cursor;
    while (cursor < source.length && !/[\u0009\u000a\u000d\u0020,\]}]/.test(source[cursor])) cursor += 1;
    if (cursor === start) invalid(`unexpected token at byte ${cursor}`);
  };

  parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) invalid(`unexpected trailing content at byte ${cursor}`);
}

export function parseStrictJson(source, field = 'evidence') {
  check(typeof source === 'string', 'INVALID_TYPE', field, `${field} must be JSON text`);
  strictJsonScanner(source, field);
  try {
    return JSON.parse(source);
  } catch (error) {
    reject('INVALID_JSON', field, `${field} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function relativePathInside(rootPath, candidatePath, field) {
  const relative = path.relative(rootPath, candidatePath);
  check(
    relative.length > 0
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    'ARTIFACT_ROOT_VIOLATION',
    field,
    `${field} must be contained by its artifact root`,
  );
  return relative.split(path.sep).join('/');
}

async function lstatRequired(filePath, field, missingCode = 'MISSING_ARTIFACT_FILE') {
  try {
    return await lstat(filePath);
  } catch (error) {
    reject(
      missingCode,
      field,
      `${field} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function collectPhysicalFiles(rootPath, field) {
  const files = new Set();
  let entriesSeen = 0;
  let bytesSeen = 0;

  const walk = async (directoryPath, relativeDirectory, depth) => {
    check(depth <= MAX_EVIDENCE_ARTIFACT_DEPTH, 'LIMIT_EXCEEDED', field, `${field} exceeds the maximum directory depth`);
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch (error) {
      reject('ARTIFACT_READ_FAILED', field, `${field} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    for await (const entry of directory) {
      entriesSeen += 1;
      check(entriesSeen <= MAX_ARTIFACT_ROOT_ENTRIES, 'LIMIT_EXCEEDED', field, `${field} contains too many filesystem entries`);
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const metadata = await lstatRequired(absolutePath, `${field}/${relativePath}`);
      check(!metadata.isSymbolicLink(), 'SYMLINK_FORBIDDEN', `${field}/${relativePath}`, 'Artifact roots must not contain symbolic links');
      if (metadata.isDirectory()) {
        await walk(absolutePath, relativePath, depth + 1);
      } else if (metadata.isFile()) {
        check(metadata.size <= MAX_REFERENCED_ARTIFACT_BYTES, 'LIMIT_EXCEEDED', `${field}/${relativePath}`, `${field}/${relativePath} exceeds the physical artifact size limit`);
        bytesSeen += metadata.size;
        check(bytesSeen <= MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES, 'LIMIT_EXCEEDED', field, `${field} exceeds the aggregate artifact byte limit`);
        files.add(relativePath);
      } else {
        reject('INVALID_ARTIFACT_FILE', `${field}/${relativePath}`, 'Artifact roots may contain only directories and regular files');
      }
    }
  };

  await walk(rootPath, '', 0);
  return files;
}

async function hashPhysicalArtifact(filePath, expected, field, options = {}) {
  const readContent = options.readContent === true;
  const metadata = await lstatRequired(filePath, field);
  check(!metadata.isSymbolicLink() && metadata.isFile(), 'INVALID_ARTIFACT_FILE', field, `${field} must be a regular non-symlink file`);
  check(metadata.size <= MAX_REFERENCED_ARTIFACT_BYTES, 'LIMIT_EXCEEDED', field, `${field} exceeds the physical artifact size limit`);
  if (readContent) {
    check(metadata.size <= MAX_P014_TRACE_BYTES, 'LIMIT_EXCEEDED', field, `${field} exceeds the P0-14 trace size limit`);
  }
  if (expected) {
    check(metadata.size === expected.bytes, 'ARTIFACT_SIZE_MISMATCH', field, `${field} byte count differs from the evidence manifest`);
  }

  if (options.rootPath && options.rootRealPath) {
    let parentRealPath;
    try {
      parentRealPath = await realpath(path.dirname(filePath));
    } catch (error) {
      reject('ARTIFACT_READ_FAILED', field, `${field} parent directory cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
    const relativeParent = path.relative(options.rootRealPath, parentRealPath);
    check(
      relativeParent === ''
        || (relativeParent !== '..'
          && !relativeParent.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relativeParent)),
      'ARTIFACT_ROOT_CHANGED',
      field,
      `${field} parent directory no longer belongs to the attested artifact root`,
    );
  }

  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    reject('ARTIFACT_READ_FAILED', field, `${field} cannot be opened safely: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const openedMetadata = await handle.stat();
    check(
      openedMetadata.isFile()
        && openedMetadata.dev === metadata.dev
        && openedMetadata.ino === metadata.ino
        && openedMetadata.size === metadata.size,
      'ARTIFACT_CHANGED',
      field,
      `${field} changed while it was being opened`,
    );
    const digest = createHash('sha256');
    const contentChunks = readContent ? [] : undefined;
    let contentTail = '';
    const scanContent = expected?.kind === P014_TRACE_ARTIFACT_KIND || shouldScanEvidenceKind(expected?.kind);
    let bytesRead = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      bytesRead += chunk.byteLength;
      check(bytesRead <= openedMetadata.size, 'ARTIFACT_CHANGED', field, `${field} grew while it was being hashed`);
      digest.update(chunk);
      contentChunks?.push(chunk);
      if (scanContent) {
        const contentResult = scanTextChunk(contentTail, chunk.toString('utf8'));
        if (contentResult.code) {
          reject(
            'SECRET_IN_ARTIFACT',
            field,
            `${field} contains a forbidden credential pattern`,
          );
        }
        contentTail = contentResult.tail;
      }
    }
    if (scanContent) {
      const contentResult = scanTextChunk(contentTail, '');
      if (contentResult.code) {
        reject(
          'SECRET_IN_ARTIFACT',
          field,
          `${field} contains a forbidden credential pattern`,
        );
      }
    }
    const finalMetadata = await handle.stat();
    check(
      finalMetadata.dev === openedMetadata.dev
        && finalMetadata.ino === openedMetadata.ino
        && finalMetadata.size === openedMetadata.size
        && finalMetadata.mtimeMs === openedMetadata.mtimeMs
        && finalMetadata.ctimeMs === openedMetadata.ctimeMs,
      'ARTIFACT_CHANGED',
      field,
      `${field} changed while it was being hashed`,
    );
    const sha256 = digest.digest('hex');
    if (expected) {
      check(
        sha256 === expected.sha256,
        'ARTIFACT_DIGEST_MISMATCH',
        field,
        `${field} SHA-256 differs from the evidence manifest`,
      );
    }
    return {
      bytes: metadata.size,
      sha256,
      ...(contentChunks ? { content: Buffer.concat(contentChunks) } : {}),
    };
  } catch (error) {
    if (error instanceof ExternalEvidenceValidationError) throw error;
    reject('ARTIFACT_READ_FAILED', field, `${field} could not be hashed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle.close();
  }
}

function validateP014PhysicalTraceBinding(value, references, field) {
  const binding = object(value, field);
  exactKeys(binding, ['proof', 'workflowRunId', 'workflowRunAttempt', 'caseId'], [], field);
  const proof = object(binding.proof, `${field}.proof`);
  validateP014Proof(proof, `${field}.proof`, references);
  const workflowRunId = runId(binding.workflowRunId, `${field}.workflowRunId`);
  const workflowRunAttempt = positiveInteger(
    binding.workflowRunAttempt,
    `${field}.workflowRunAttempt`,
  );
  const caseId = string(binding.caseId, `${field}.caseId`);
  check(caseId === 'P0-14', 'P014_TRACE_BINDING_MISMATCH', `${field}.caseId`, 'Physical P0-14 trace must bind case P0-14');
  return {
    proof,
    workflowRunId,
    workflowRunAttempt,
    caseId,
    artifact: proof.traceArtifact,
  };
}

function validateP014PhysicalTraceDocument(content, binding, field) {
  let text;
  try {
    // `TextDecoder` strips an initial UTF-8 BOM by default. Preserve it in the
    // decoded text so the byte-level canonical form check below rejects BOMs
    // instead of silently accepting a second representation of the document.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    reject('INVALID_UTF8', field, `${field} must be valid UTF-8 JSON`);
  }
  const document = object(parseStrictJson(text, field), field);
  exactKeys(document, [
    'schemaVersion',
    'kind',
    'workflowRunId',
    'workflowRunAttempt',
    'caseId',
    'eventsSha256',
    'claimsSha256',
    'events',
  ], [], field);
  check(
    document.schemaVersion === P014_TRACE_SCHEMA_VERSION,
    'P014_TRACE_SCHEMA_MISMATCH',
    `${field}.schemaVersion`,
    'Unsupported physical P0-14 trace schema',
  );
  check(
    string(document.kind, `${field}.kind`) === 'P014_EXECUTION_TRACE',
    'P014_TRACE_SCHEMA_MISMATCH',
    `${field}.kind`,
    'Physical P0-14 trace has the wrong document kind',
  );
  check(
    runId(document.workflowRunId, `${field}.workflowRunId`) === binding.workflowRunId,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.workflowRunId`,
    'Physical P0-14 trace belongs to a different workflow run',
  );
  check(
    positiveInteger(document.workflowRunAttempt, `${field}.workflowRunAttempt`)
      === binding.workflowRunAttempt,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.workflowRunAttempt`,
    'Physical P0-14 trace belongs to a different workflow run attempt',
  );
  check(
    string(document.caseId, `${field}.caseId`) === binding.caseId,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.caseId`,
    'Physical P0-14 trace belongs to a different case',
  );
  const events = array(document.events, `${field}.events`, P014_TRACE_EVENT_COUNT);
  const eventsSha256 = sha(document.eventsSha256, `${field}.eventsSha256`);
  const computedEventsSha256 = sha256(stableJson(events));
  check(
    eventsSha256 === computedEventsSha256,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.eventsSha256`,
    'Physical P0-14 trace events digest does not match its events',
  );
  check(
    eventsSha256 === binding.artifact.eventsSha256,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.eventsSha256`,
    'Physical P0-14 trace events digest differs from the evidence binding',
  );
  const rebuiltClaims = reconstructP014TraceClaims(events, `${field}.events`);
  const claimsSha256 = sha(document.claimsSha256, `${field}.claimsSha256`);
  const computedClaimsSha256 = sha256(stableJson(rebuiltClaims));
  check(
    claimsSha256 === computedClaimsSha256,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.claimsSha256`,
    'Physical P0-14 trace claims digest does not match its claims',
  );
  check(
    claimsSha256 === binding.artifact.claimsSha256,
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.claimsSha256`,
    'Physical P0-14 trace claims digest differs from the evidence binding',
  );
  check(
    stableJson(rebuiltClaims) === stableJson(p014TraceClaims(binding.proof)),
    'P014_TRACE_BINDING_MISMATCH',
    `${field}.events`,
    'Physical P0-14 trace events do not reconstruct the complete validated proof',
  );
  check(
    text === `${stableJson(document)}\n`,
    'P014_TRACE_NON_CANONICAL',
    field,
    'Physical P0-14 trace must use canonical JSON with one trailing newline',
  );
}

export async function verifyPhysicalArtifactRoot(options) {
  const value = object(options, 'physicalArtifactRoot');
  exactKeys(value, ['rootPath', 'evidencePath', 'references', 'field'], ['p014Trace'], 'physicalArtifactRoot');
  const field = string(value.field, 'physicalArtifactRoot.field');
  const rootPath = path.resolve(string(value.rootPath, 'physicalArtifactRoot.rootPath'));
  const evidencePath = path.resolve(string(value.evidencePath, 'physicalArtifactRoot.evidencePath'));
  const rootMetadata = await lstatRequired(rootPath, field, 'INVALID_ARTIFACT_ROOT');
  check(!rootMetadata.isSymbolicLink() && rootMetadata.isDirectory(), 'INVALID_ARTIFACT_ROOT', field, `${field} must be a regular directory, not a symlink`);
  let rootRealPath;
  try {
    rootRealPath = await realpath(rootPath);
  } catch (error) {
    reject('INVALID_ARTIFACT_ROOT', field, `${field} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  const evidenceRelativePath = relativePathInside(rootPath, evidencePath, `${field}.evidencePath`);
  const evidenceMetadata = await lstatRequired(evidencePath, `${field}.evidencePath`);
  check(!evidenceMetadata.isSymbolicLink() && evidenceMetadata.isFile(), 'INVALID_FILE', `${field}.evidencePath`, 'Evidence JSON must be a regular non-symlink file');

  const registry = new ArtifactReferenceRegistry(`${field}.references`);
  const references = array(value.references, `${field}.references`, 512).map((entry, index) => {
    const referenceField = `${field}.references[${index}]`;
    const reference = validateArtifact(entry, referenceField);
    registry.add(reference, `${referenceField}.name`);
    return reference;
  });
  check(references.length > 0, 'MISSING_ARTIFACT', `${field}.references`, `${field}.references must not be empty`);
  const traceReferences = references.filter((reference) => reference.kind === P014_TRACE_ARTIFACT_KIND);
  check(
    traceReferences.length === 0 || value.p014Trace !== undefined,
    'P014_TRACE_BINDING_REQUIRED',
    `${field}.p014Trace`,
    'A P0-14 trace artifact requires its validated proof binding',
  );
  check(
    value.p014Trace === undefined || traceReferences.length === 1,
    'P014_TRACE_ARTIFACT_MISMATCH',
    `${field}.references`,
    'A P0-14 proof binding requires exactly one physical trace reference',
  );
  const p014Trace = value.p014Trace === undefined
    ? undefined
    : validateP014PhysicalTraceBinding(value.p014Trace, references, `${field}.p014Trace`);
  check(
    !registry.references.has(evidenceRelativePath),
    'ARTIFACT_PATH_COLLISION',
    `${field}.evidencePath`,
    'Evidence JSON cannot also be a referenced artifact',
  );

  const physicalFiles = await collectPhysicalFiles(rootPath, field);
  check(physicalFiles.has(evidenceRelativePath), 'INVALID_FILE', `${field}.evidencePath`, 'Evidence JSON is missing from its artifact root');
  const expectedFiles = new Set([evidenceRelativePath]);
  let p014TraceContent;
  for (const [index, reference] of references.entries()) {
    const referenceField = `${field}.references[${index}]`;
    const candidatePath = path.resolve(rootPath, ...reference.name.split('/'));
    check(
      relativePathInside(rootPath, candidatePath, `${referenceField}.name`) === reference.name,
      'ARTIFACT_ROOT_VIOLATION',
      `${referenceField}.name`,
      'Artifact path normalization changed the manifest name',
    );
    check(physicalFiles.has(reference.name), 'MISSING_ARTIFACT_FILE', `${referenceField}.name`, `${reference.name} is missing from the artifact root`);
    const physicalArtifact = await hashPhysicalArtifact(
      candidatePath,
      reference,
      `${referenceField}.name`,
      {
        readContent: reference.kind === P014_TRACE_ARTIFACT_KIND,
        rootPath,
        rootRealPath,
      },
    );
    if (reference.kind === P014_TRACE_ARTIFACT_KIND) p014TraceContent = physicalArtifact.content;
    expectedFiles.add(reference.name);
  }
  for (const physicalFile of physicalFiles) {
    check(
      expectedFiles.has(physicalFile),
      'UNREFERENCED_ARTIFACT_FILE',
      `${field}/${physicalFile}`,
      `${physicalFile} is not referenced by the evidence manifest`,
    );
  }
  if (p014Trace) {
    check(p014TraceContent !== undefined, 'MISSING_ARTIFACT_FILE', `${field}.p014Trace`, 'Physical P0-14 trace content is missing');
    validateP014PhysicalTraceDocument(p014TraceContent, p014Trace, `${field}.p014Trace.document`);
  }

  const finalRootMetadata = await lstatRequired(rootPath, field, 'INVALID_ARTIFACT_ROOT');
  check(
    finalRootMetadata.isDirectory()
      && !finalRootMetadata.isSymbolicLink()
      && finalRootMetadata.dev === rootMetadata.dev
      && finalRootMetadata.ino === rootMetadata.ino,
    'ARTIFACT_ROOT_CHANGED',
    field,
    `${field} changed while its physical files were being verified`,
  );
  let finalRootRealPath;
  try {
    finalRootRealPath = await realpath(rootPath);
  } catch (error) {
    reject('ARTIFACT_ROOT_CHANGED', field, `${field} could not be resolved after verification: ${error instanceof Error ? error.message : String(error)}`);
  }
  check(
    finalRootRealPath === rootRealPath,
    'ARTIFACT_ROOT_CHANGED',
    field,
    `${field} physical root changed while its files were being verified`,
  );

  return {
    field,
    filesVerified: references.length,
    bytesVerified: references.reduce((total, entry) => total + entry.bytes, 0),
    p014TraceVerified: p014Trace !== undefined,
  };
}

export async function verifyVisualCandidateAgainstReleaseAssets(options) {
  const value = object(options, 'releaseAssets');
  exactKeys(value, ['rootPath', 'candidate'], [], 'releaseAssets');
  const rootPath = path.resolve(string(value.rootPath, 'releaseAssets.rootPath'));
  const rootMetadata = await lstatRequired(rootPath, 'releaseAssets.rootPath', 'INVALID_ARTIFACT_ROOT');
  check(!rootMetadata.isSymbolicLink() && rootMetadata.isDirectory(), 'INVALID_ARTIFACT_ROOT', 'releaseAssets.rootPath', 'Release asset root must be a regular directory');
  let rootRealPath;
  try {
    rootRealPath = await realpath(rootPath);
  } catch (error) {
    reject('INVALID_ARTIFACT_ROOT', 'releaseAssets.rootPath', `Release asset root cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  const candidate = object(value.candidate, 'releaseAssets.candidate');
  exactKeys(candidate, ['platform', 'artifactName', 'artifactSha256'], [], 'releaseAssets.candidate');
  const expectedCandidate = validateVisualCandidateAsset(
    candidate.platform,
    candidate.artifactName,
    candidate.artifactSha256,
    'releaseAssets.candidate',
  );

  const files = Array.from(await collectPhysicalFiles(rootPath, 'releaseAssets.rootPath')).sort();
  check(files.length > 0, 'MISSING_ARTIFACT_FILE', 'releaseAssets.rootPath', 'Release asset root is empty');
  // The current visual evidence schema carries one installer-bound browser
  // session. Never let it certify a multi-platform release with untested
  // Windows/macOS assets; the producer must evolve to an explicit per-platform
  // candidate contract before this guard is relaxed.
  check(
    files.length === 1,
    'VISUAL_PLATFORM_COVERAGE_REQUIRED',
    'releaseAssets.rootPath',
    'Visual evidence must cover every published installer; the single-candidate contract cannot certify a multi-platform release',
  );
  const manifest = [];
  for (const [index, relativePath] of files.entries()) {
    const safePath = safeArtifactPath(relativePath, `releaseAssets.files[${index}].name`);
    check(!safePath.includes('/'), 'UNSAFE_ARTIFACT_PATH', `releaseAssets.files[${index}].name`, 'Published release assets must be top-level files');
    const identity = await hashPhysicalArtifact(
      path.join(rootPath, safePath),
      undefined,
      `releaseAssets.files[${index}]`,
      { rootPath, rootRealPath },
    );
    manifest.push({ name: safePath, ...identity });
  }
  const matches = manifest.filter((asset) => asset.name === expectedCandidate.artifactName);
  check(matches.length === 1, 'VISUAL_CANDIDATE_NOT_PUBLISHED', 'releaseAssets.candidate.artifactName', 'Visual candidate is not present exactly once in this release build');
  check(
    matches[0].sha256 === expectedCandidate.artifactSha256,
    'VISUAL_CANDIDATE_DIGEST_MISMATCH',
    'releaseAssets.candidate.artifactSha256',
    'Visual candidate digest differs from the release build asset',
  );
  const finalRootMetadata = await lstatRequired(rootPath, 'releaseAssets.rootPath', 'INVALID_ARTIFACT_ROOT');
  check(
    finalRootMetadata.isDirectory()
      && !finalRootMetadata.isSymbolicLink()
      && finalRootMetadata.dev === rootMetadata.dev
      && finalRootMetadata.ino === rootMetadata.ino,
    'ARTIFACT_ROOT_CHANGED',
    'releaseAssets.rootPath',
    'Release asset root changed while its files were being verified',
  );
  let finalRootRealPath;
  try {
    finalRootRealPath = await realpath(rootPath);
  } catch (error) {
    reject('ARTIFACT_ROOT_CHANGED', 'releaseAssets.rootPath', `Release asset root could not be resolved after verification: ${error instanceof Error ? error.message : String(error)}`);
  }
  check(
    finalRootRealPath === rootRealPath,
    'ARTIFACT_ROOT_CHANGED',
    'releaseAssets.rootPath',
    'Release asset root physical identity changed while its files were being verified',
  );
  return { candidate: expectedCandidate, manifest };
}

async function readBoundedText(filePath, expectedMetadata, field) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedMetadata = await handle.stat();
    check(
      openedMetadata.isFile()
        && openedMetadata.dev === expectedMetadata.dev
        && openedMetadata.ino === expectedMetadata.ino
        && openedMetadata.size === expectedMetadata.size,
      'ARTIFACT_CHANGED',
      field,
      `${field} changed while it was being opened`,
    );
    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      bytes += chunk.byteLength;
      check(bytes <= openedMetadata.size, 'ARTIFACT_CHANGED', field, `${field} grew while it was being read`);
      check(bytes <= MAX_EVIDENCE_BYTES, 'LIMIT_EXCEEDED', field, `${field} exceeds the evidence size limit`);
      chunks.push(chunk);
    }
    const finalMetadata = await handle.stat();
    check(
      finalMetadata.dev === openedMetadata.dev
        && finalMetadata.ino === openedMetadata.ino
        && finalMetadata.size === openedMetadata.size
        && finalMetadata.mtimeMs === openedMetadata.mtimeMs
        && finalMetadata.ctimeMs === openedMetadata.ctimeMs,
      'ARTIFACT_CHANGED',
      field,
      `${field} changed while it was being read`,
    );
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof ExternalEvidenceValidationError) throw error;
    reject('ARTIFACT_READ_FAILED', field, `${field} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle?.close();
  }
}

async function readEvidence(filePath, field) {
  const file = await lstat(filePath);
  check(file.isFile() && !file.isSymbolicLink(), 'INVALID_FILE', field, `${field} is not a regular file`);
  check(file.size > 0 && file.size <= MAX_EVIDENCE_BYTES, 'LIMIT_EXCEEDED', field, `${field} exceeds the evidence size limit`);
  return parseStrictJson(await readBoundedText(filePath, file, field), field);
}

export function parseArguments(argv) {
  const values = {};
  const allowed = new Set([
    'quality',
    'gateway',
    'gateway-artifact-root',
    'visual',
    'visual-artifact-root',
    'soak',
    'soak-artifact-root',
    'gateway-run-id',
    'gateway-run-attempt',
    'visual-run-id',
    'visual-run-attempt',
    'soak-run-id',
    'soak-run-attempt',
    'release-asset-root',
    'release-ref',
    'source-sha',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    check(typeof flag === 'string' && flag.startsWith('--'), 'INVALID_ARGUMENT', 'arguments', `Unexpected argument: ${flag ?? '<missing>'}`);
    const key = flag.slice(2);
    check(allowed.has(key), 'INVALID_ARGUMENT', 'arguments', `Unknown argument: ${flag}`);
    check(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'INVALID_ARGUMENT', 'arguments', `${flag} requires a value`);
    check(!Object.hasOwn(values, key), 'INVALID_ARGUMENT', 'arguments', `${flag} was provided more than once`);
    values[key] = value;
  }
  for (const key of allowed) {
    check(Object.hasOwn(values, key), 'INVALID_ARGUMENT', 'arguments', `--${key} is required`);
  }
  return values;
}

async function main() {
  let decision;
  let sourceBinding;
  try {
    const args = parseArguments(process.argv.slice(2));
    const sourceSha = gitObject(args['source-sha'], 'source-sha');
    const releaseRef = string(
      args['release-ref'],
      'release-ref',
      /^refs\/tags\/v[0-9A-Za-z][0-9A-Za-z._-]*$/,
    );
    sourceBinding = { sourceSha, releaseRef };
    const [quality, gateway, visual, soak] = await Promise.all([
      readEvidence(path.resolve(args.quality), 'quality'),
      readEvidence(path.resolve(args.gateway), 'gateway'),
      readEvidence(path.resolve(args.visual), 'visual'),
      readEvidence(path.resolve(args.soak), 'soak'),
    ]);
    decision = assessExternalReleaseEvidence({
      quality,
      gateway,
      visual,
      soak,
      producers: {
        gateway: {
          runId: args['gateway-run-id'],
          runAttempt: Number(runId(args['gateway-run-attempt'], 'gateway-run-attempt')),
        },
        visual: {
          runId: args['visual-run-id'],
          runAttempt: Number(runId(args['visual-run-attempt'], 'visual-run-attempt')),
        },
        soak: {
          runId: args['soak-run-id'],
          runAttempt: Number(runId(args['soak-run-attempt'], 'soak-run-attempt')),
        },
      },
      releaseRef,
      nowMs: Date.now(),
    });
    // Keep blocked decisions useful even when validation stops before a
    // subject can be parsed. The attestation still supplies the cryptographic
    // binding; these fields make the durable JSON self-describing.
    decision = { ...decision, ...sourceBinding };
    if (decision.kind === 'SATISFIED') {
      const p014Case = gateway.cases.find((entry) => entry.id === 'P0-14');
      const physicalResults = await Promise.all([
        verifyPhysicalArtifactRoot({
          rootPath: args['gateway-artifact-root'],
          evidencePath: args.gateway,
          references: decision.artifactReferences.gateway,
          field: 'gatewayArtifactRoot',
          p014Trace: {
            proof: p014Case.p014,
            workflowRunId: gateway.workflow.runId,
            workflowRunAttempt: gateway.workflow.runAttempt,
            caseId: 'P0-14',
          },
        }),
        verifyPhysicalArtifactRoot({
          rootPath: args['visual-artifact-root'],
          evidencePath: args.visual,
          references: decision.artifactReferences.visual,
          field: 'visualArtifactRoot',
        }),
        verifyPhysicalArtifactRoot({
          rootPath: args['soak-artifact-root'],
          evidencePath: args.soak,
          references: decision.artifactReferences.soak,
          field: 'soakArtifactRoot',
        }),
      ]);
      const releaseAssets = await verifyVisualCandidateAgainstReleaseAssets({
        rootPath: args['release-asset-root'],
        candidate: decision.visualCandidate,
      });
      decision = {
        ...decision,
        physicalArtifacts: Object.fromEntries(
          ['gateway', 'visual', 'soak'].map((kind, index) => [kind, {
            filesVerified: physicalResults[index].filesVerified,
            bytesVerified: physicalResults[index].bytesVerified,
            ...(kind === 'gateway' ? { p014TraceVerified: physicalResults[index].p014TraceVerified } : {}),
          }]),
        ),
        releaseAssetManifest: releaseAssets.manifest,
      };
    }
  } catch (error) {
    const failure = error instanceof ExternalEvidenceValidationError
      ? error
      : new ExternalEvidenceValidationError('VALIDATOR_FAILED', 'validator', error instanceof Error ? error.message : String(error));
    decision = {
      kind: 'BLOCKED',
      code: failure.code,
      field: failure.field,
      message: failure.message,
      ...(sourceBinding ?? {}),
    };
  }

  decision = { schemaVersion: 1, ...decision };
  const output = `${JSON.stringify(decision, null, 2)}\n`;
  // Always emit the machine-readable decision on stdout so release
  // orchestration can persist BLOCKED decisions as well as successful ones.
  // Keep the non-zero exit status as the enforcement boundary.
  process.stdout.write(output);
  if (decision.kind !== 'SATISFIED') {
    process.stderr.write(`External release evidence blocked: ${decision.code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
