#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  COLLABORATION_ARCHIVE_DESTINATION,
  CONTAINER_HOME,
  DEFAULT_USER_GATEWAY_PORT,
  DETERMINISTIC_PROVIDER_DESTINATION,
  DockerRuntime,
  OFFICIAL_OPENCLAW_IMAGE,
  OFFICIAL_OPENCLAW_IMAGE_DIGEST,
  OFFICIAL_OPENCLAW_VERSION,
  SmokeInvariantError,
  allocateRandomGatewayPort,
  assertCapabilities,
  assertContainerSecurity,
  assertInstallMountAllowlist,
  assertNetworkInspection,
  assertProcessArgumentsSecure,
  assertRuntimeMountAllowlist,
  cleanupResources,
  collaborationBootstrapContainerName,
  collaborationResourceNames,
  createSmokeRunId,
  errorForEvidence,
  loadAndValidateBundle,
  redactSensitive,
  sha256,
  waitForGatewayReady,
  writeJsonAtomic,
} from './verify-collaboration-real-gateway.mjs';
import { PROVIDER_MODEL_ID, PROVIDER_PORT } from './collaboration-deterministic-provider.mjs';
import {
  GATEWAY_EVIDENCE_LOG_POLICY,
  sanitizeGatewayEvidenceLog,
} from './evidence-log-sanitizer.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const PROVIDER_SOURCE_PATH = path.join(SCRIPT_DIRECTORY, 'collaboration-deterministic-provider.mjs');
const DEFAULT_EVIDENCE_ROOT = path.join(REPOSITORY_ROOT, '.artifacts', 'collaboration-behavioral-gateway');
const BEHAVIORAL_EVIDENCE_FORMAT_VERSION = 1;
const RPC_TIMEOUT_MS = 45_000;
const SCENARIO_TIMEOUT_MS = 3 * 60_000;
const PROVIDER_ALIAS = 'qa-provider';
const PROVIDER_BASE_URL = `http://${PROVIDER_ALIAS}:${PROVIDER_PORT}`;
const MODEL_REFERENCE = `junqi-qa/${PROVIDER_MODEL_ID}`;
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const TERMINAL_ATTEMPT_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ABANDONED']);
const PRIVATE_GATEWAY_LOG_FRAGMENTS = Object.freeze([
  'JunQi behavioral origin',
  'Verify collaboration behavior for',
  'The supplied collaboration goal',
  'Produce verifiable deterministic evidence',
]);

export class BehavioralGatewayFailure extends Error {
  constructor(message, evidencePath) {
    super(message);
    this.name = 'BehavioralGatewayFailure';
    this.code = 'BEHAVIORAL_GATEWAY_FAILED';
    this.evidencePath = evidencePath;
  }
}

function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new SmokeInvariantError(code, message, details);
}

export function safeBehavioralErrorForEvidence(error, secrets = []) {
  const safe = errorForEvidence(error, secrets);
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = typeof safe.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(safe.code)
    ? safe.code
    : 'UNCLASSIFIED';
  return {
    category: 'BEHAVIORAL_GATEWAY_ERROR',
    code,
    messageSha256: sha256(message),
    messageBytes: Buffer.byteLength(message, 'utf8'),
    ...(safe.exitCode !== undefined ? { exitCode: safe.exitCode } : {}),
    ...(safe.signal !== undefined ? { signal: safe.signal } : {}),
    ...(safe.timedOut !== undefined ? { timedOut: safe.timedOut } : {}),
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function writeEnvelope(params) {
  const { commandId, payloadHash: _payloadHash, ...payload } = params;
  invariant(typeof commandId === 'string' && commandId.length > 0, 'COMMAND_ID_INVALID', 'commandId is required');
  invariant(
    typeof payload.expectedCollaborationInstanceId === 'string'
      && payload.expectedCollaborationInstanceId.length > 0,
    'INSTANCE_FENCE_MISSING',
    'expectedCollaborationInstanceId is required for every collaboration write',
  );
  return {
    commandId,
    ...payload,
    payloadHash: createHash('sha256').update(stableStringify(payload)).digest('hex'),
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findRecord(value, predicate, seen = new Set()) {
  if (!isRecord(value) || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const candidate of Object.values(value)) {
    if (isRecord(candidate)) {
      const found = findRecord(candidate, predicate, seen);
      if (found) return found;
    }
  }
  return null;
}

function rpcRecord(value, predicate, context) {
  const record = findRecord(value, predicate);
  invariant(record, 'RPC_RESPONSE_INVALID', `${context} returned an unexpected payload`, { value });
  return record;
}

function messageText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(messageText).filter(Boolean).join('\n');
  if (!isRecord(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if ('content' in value) return messageText(value.content);
  if (isRecord(value.message)) return messageText(value.message);
  return '';
}

function messageRole(value) {
  if (!isRecord(value)) return undefined;
  if (typeof value.role === 'string') return value.role;
  return isRecord(value.message) && typeof value.message.role === 'string' ? value.message.role : undefined;
}

export function nativeHistoryMessageId(value) {
  if (!isRecord(value)) return undefined;
  const openclawMetadata = isRecord(value.__openclaw) ? value.__openclaw : null;
  if (typeof openclawMetadata?.id === 'string' && openclawMetadata.id) return openclawMetadata.id;
  if (isRecord(value.message)) {
    const nestedId = nativeHistoryMessageId(value.message);
    if (nestedId) return nestedId;
  }
  for (const candidate of [value.id, value.messageId, value.message_id]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return undefined;
}

export function summarizeHistoryContentShapes(messages) {
  invariant(Array.isArray(messages), 'TRANSCRIPT_HISTORY_INVALID', 'Transcript messages must be an array');
  const shapes = new Map();
  for (const message of messages) {
    const content = isRecord(message) ? message.content : undefined;
    const shape = Array.isArray(content)
      ? {
          contentType: 'array',
          blockTypes: [...new Set(content.map((block) => (
            isRecord(block) && typeof block.type === 'string' ? block.type : 'unknown'
          )))].sort(),
        }
      : { contentType: content === null ? 'null' : typeof content, blockTypes: [] };
    shapes.set(stableStringify(shape), shape);
  }
  return [...shapes.values()].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

export function createNativeMessageDeltaSpecification(baselineMessages, matchesMessage) {
  invariant(Array.isArray(baselineMessages), 'TRANSCRIPT_HISTORY_INVALID', 'Baseline transcript messages must be an array');
  invariant(typeof matchesMessage === 'function', 'TRANSCRIPT_MATCHER_INVALID', 'Transcript message matcher must be a function');

  const collectByNativeId = (messages, includeBaseline) => {
    invariant(Array.isArray(messages), 'TRANSCRIPT_HISTORY_INVALID', 'Transcript messages must be an array');
    const messagesById = new Map();
    for (const message of messages) {
      if (!matchesMessage(message)) continue;
      const messageId = nativeHistoryMessageId(message);
      invariant(messageId, 'TRANSCRIPT_IDENTITY_MISSING', 'Matched transcript message has no stable native id');
      if (includeBaseline(messageId)) messagesById.set(messageId, message);
    }
    return messagesById;
  };

  const baselineById = collectByNativeId(baselineMessages, () => true);
  const selectAdded = (messages) => [
    ...collectByNativeId(messages, (messageId) => !baselineById.has(messageId)).values(),
  ];

  return Object.freeze({
    baselineCount: baselineById.size,
    selectAdded,
    expectExactlyOneAdded(messages, failureMessage) {
      const added = selectAdded(messages);
      invariant(
        added.length === 1,
        'TRANSCRIPT_DUPLICATED',
        failureMessage,
        { baselineCount: baselineById.size, newMessageCount: added.length },
      );
      return added[0];
    },
  });
}

function historyPayload(value) {
  return rpcRecord(value, (record) => Array.isArray(record.messages), 'chat.history');
}

function historySessionId(history) {
  for (const candidate of [history.sessionId, history.session_id, history.sessionInfo?.sessionId]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return undefined;
}

function runSnapshot(value) {
  return rpcRecord(
    value,
    (record) => isRecord(record.run) && Array.isArray(record.attempts) && Array.isArray(record.workItems),
    'junqi.collab.run.get',
  );
}

function taskList(value) {
  return rpcRecord(value, (record) => Array.isArray(record.tasks), 'tasks.list').tasks;
}

function taskValue(value) {
  return rpcRecord(value, (record) => isRecord(record.task) && typeof record.task.id === 'string', 'tasks.get').task;
}

function acceptedValue(value, expectedCollaborationInstanceId) {
  const accepted = rpcRecord(
    value,
    (record) => record.accepted === true && typeof record.runId === 'string',
    'collaboration write',
  );
  invariant(
    accepted.collaborationInstanceId === expectedCollaborationInstanceId,
    'WRITE_INSTANCE_MISMATCH',
    'Collaboration write response does not match the fenced database instance',
    {
      expectedCollaborationInstanceId,
      actualCollaborationInstanceId: accepted.collaborationInstanceId,
    },
  );
  return accepted;
}

function providerCount(state, kind) {
  return Number(state?.counts?.[kind] ?? 0);
}

function providerCompletedCount(state, kind) {
  return state.requests.filter((request) => request.kind === kind && request.outcome === 'completed').length;
}

function requestDelta(before, after, kind) {
  return providerCount(after, kind) - providerCount(before, kind);
}

async function poll(description, operation, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? SCENARIO_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 350;
  const startedAt = Date.now();
  let lastValue;
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await operation();
      if (await predicate(lastValue)) return lastValue;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new SmokeInvariantError('BEHAVIOR_TIMEOUT', `${description} timed out after ${timeoutMs} ms`, {
    lastValue,
    lastError: lastError instanceof Error ? lastError.message : lastError,
  });
}

export function deterministicModelsConfig() {
  return {
    mode: 'replace',
    providers: {
      'junqi-qa': {
        baseUrl: `${PROVIDER_BASE_URL}/v1`,
        apiKey: 'test',
        api: 'openai-responses',
        request: { allowPrivateNetwork: true },
        models: [{
          id: PROVIDER_MODEL_ID,
          name: PROVIDER_MODEL_ID,
          api: 'openai-responses',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 4_096,
        }],
      },
    },
  };
}

export function behavioralBootstrapPlan(metadata, gatewayPort) {
  const agents = [
    {
      id: 'coordinator',
      default: true,
      name: 'JunQi behavioral coordinator',
      workspace: `${CONTAINER_HOME}/workspaces/coordinator`,
      model: MODEL_REFERENCE,
      subagents: { allowAgents: ['coordinator', 'worker'] },
    },
    {
      id: 'worker',
      name: 'JunQi behavioral worker',
      workspace: `${CONTAINER_HOME}/workspaces/worker`,
      model: MODEL_REFERENCE,
    },
  ];
  return [
    { id: 'gateway-mode', args: ['config', 'set', 'gateway.mode', '"local"', '--strict-json'] },
    { id: 'gateway-bind', args: ['config', 'set', 'gateway.bind', '"loopback"', '--strict-json'] },
    { id: 'gateway-port', args: ['config', 'set', 'gateway.port', String(gatewayPort), '--strict-json'] },
    { id: 'models', args: ['config', 'set', 'models', JSON.stringify(deterministicModelsConfig()), '--strict-json', '--replace'] },
    { id: 'default-model', args: ['config', 'set', 'agents.defaults.model', JSON.stringify({ primary: MODEL_REFERENCE }), '--strict-json'] },
    {
      id: 'model-params',
      args: [
        'config', 'set', 'agents.defaults.models',
        JSON.stringify({ [MODEL_REFERENCE]: { params: { transport: 'sse', openaiWsWarmup: false } } }),
        '--strict-json', '--replace',
      ],
    },
    { id: 'workspace', args: ['config', 'set', 'agents.defaults.workspace', JSON.stringify(`${CONTAINER_HOME}/workspaces/default`), '--strict-json'] },
    { id: 'skip-bootstrap', args: ['config', 'set', 'agents.defaults.skipBootstrap', 'true', '--strict-json'] },
    { id: 'disable-heartbeat', args: ['config', 'set', 'agents.defaults.heartbeat', JSON.stringify({ every: '0m' }), '--strict-json'] },
    { id: 'agents', args: ['config', 'set', 'agents.list', JSON.stringify(agents), '--strict-json', '--replace'] },
    {
      id: 'install',
      args: ['plugins', 'install', '--force', '--pin', `npm-pack:${COLLABORATION_ARCHIVE_DESTINATION}`],
      archive: true,
      keepContainer: true,
      timeoutMs: 5 * 60_000,
    },
    { id: 'plugin-allowlist', args: ['config', 'set', 'plugins.allow', JSON.stringify([metadata.pluginId]), '--strict-json', '--replace'] },
    { id: 'enable', args: ['plugins', 'enable', metadata.pluginId] },
    {
      id: 'plugin-config',
      args: [
        'config', 'set', `plugins.entries.${metadata.pluginId}.config`,
        JSON.stringify({
          coordinatorAgentId: 'coordinator',
          allowedAgentIds: ['coordinator', 'worker'],
          maxConcurrency: 2,
          maxWorkItems: 8,
          attemptTimeoutMs: 60_000,
          retentionDays: 365,
        }),
        '--strict-json',
      ],
    },
    { id: 'validate-config', args: ['config', 'validate', '--json'] },
    { id: 'inspect-plugin', args: ['plugins', 'inspect', metadata.pluginId, '--json'] },
  ];
}

export function assertProviderMountAllowlist(mounts, sourcePath) {
  invariant(Array.isArray(mounts) && mounts.length === 1, 'PROVIDER_MOUNT_INVALID', 'Provider must have exactly one mount');
  const mount = mounts[0];
  invariant(mount.Type === 'bind', 'PROVIDER_MOUNT_INVALID', 'Provider source must be a bind mount');
  invariant(mount.Destination === DETERMINISTIC_PROVIDER_DESTINATION, 'PROVIDER_MOUNT_INVALID', 'Provider mount target is wrong');
  invariant(mount.RW === false, 'PROVIDER_MOUNT_INVALID', 'Provider source mount must be read-only');
  const normalizedSource = path.resolve(String(mount.Source));
  const expectedSource = path.resolve(sourcePath);
  const desktopSources = [
    path.posix.normalize(`/host_mnt${expectedSource}`),
    path.posix.normalize(`/run/desktop/mnt/host${expectedSource}`),
  ];
  invariant(
    normalizedSource === expectedSource || desktopSources.includes(path.posix.normalize(String(mount.Source))),
    'PROVIDER_MOUNT_INVALID',
    'Provider mount source is not the reviewed script',
  );
  return [{ type: 'bind', source: expectedSource, destination: DETERMINISTIC_PROVIDER_DESTINATION, readWrite: false }];
}

function bootstrapName(runId, step) {
  return collaborationBootstrapContainerName(runId, `behavior-${step}`);
}

class BehavioralGatewayFixture {
  constructor({ docker, names, resources, runId, gatewayPort, providerSourcePath, evidence, step }) {
    this.docker = docker;
    this.names = names;
    this.resources = resources;
    this.runId = runId;
    this.gatewayPort = gatewayPort;
    this.providerSourcePath = providerSourcePath;
    this.evidence = evidence;
    this.step = step;
  }

  async start(bundle) {
    await this.step('create-volume', () => this.docker.createVolume(this.names.volumeName));
    await this.step('create-setup-network', () => this.docker.createNetwork(this.names.setupNetworkName, false));
    const setupInspection = await this.step('inspect-setup-network', () => this.docker.networkInspection(this.names.setupNetworkName));
    this.evidence.isolation.setupNetwork = assertNetworkInspection(setupInspection, {
      name: this.names.setupNetworkName,
      internal: false,
      runId: this.runId,
    });

    for (const planned of behavioralBootstrapPlan(bundle.metadata, this.gatewayPort)) {
      const containerName = bootstrapName(this.runId, planned.id);
      this.resources.bootstrapContainerNames.add(containerName);
      const result = await this.step(`bootstrap-${planned.id}`, () => this.docker.runBootstrap({
        containerName,
        networkName: this.names.setupNetworkName,
        volumeName: this.names.volumeName,
        archivePath: planned.archive ? bundle.archivePath : undefined,
        autoRemove: planned.keepContainer !== true,
        openclawArgs: planned.args,
        timeoutMs: planned.timeoutMs,
      }));
      if (planned.id === 'install') {
        const mounts = await this.step('inspect-installer-mounts', () => this.docker.containerMounts(containerName));
        this.evidence.isolation.installerMounts = assertInstallMountAllowlist(mounts, this.names.volumeName, bundle.archivePath);
        const security = await this.step('inspect-installer-security', () => this.docker.containerSecurity(containerName));
        this.evidence.isolation.installerSecurity = assertContainerSecurity(security, this.names.setupNetworkName);
        await this.step('remove-installer-container', () => this.docker.removeOwnedContainer(containerName));
        this.resources.bootstrapContainerNames.delete(containerName);
      }
      if (planned.id === 'validate-config') this.evidence.configValidation = result.stdout.trim().slice(-4_096);
    }

    await this.step('remove-setup-network', () => this.docker.removeOwnedNetwork(this.names.setupNetworkName));
    this.resources.setupNetworkName = null;
    await this.step('create-runtime-network', () => this.docker.createNetwork(this.names.runtimeNetworkName, true));
    const runtimeInspection = await this.step('inspect-runtime-network', () => this.docker.networkInspection(this.names.runtimeNetworkName));
    this.evidence.isolation.runtimeNetwork = assertNetworkInspection(runtimeInspection, {
      name: this.names.runtimeNetworkName,
      internal: true,
      runId: this.runId,
    });

    await this.step('start-deterministic-provider', () => this.docker.startProviderSidecar({
      containerName: this.names.providerContainerName,
      networkName: this.names.runtimeNetworkName,
      networkAlias: PROVIDER_ALIAS,
      sourcePath: this.providerSourcePath,
    }));
    this.resources.sidecarContainerNames.add(this.names.providerContainerName);
    await this.step('wait-provider-readiness', () => poll(
      'deterministic provider readiness',
      () => this.docker.containerJsonRequest(this.names.providerContainerName, `http://127.0.0.1:${PROVIDER_PORT}/readyz`),
      (response) => response.ok === true,
      { timeoutMs: 30_000 },
    ));
    const providerMounts = await this.step('inspect-provider-mounts', () => this.docker.containerMounts(this.names.providerContainerName));
    this.evidence.isolation.providerMounts = assertProviderMountAllowlist(providerMounts, this.providerSourcePath);
    const providerSecurity = await this.step('inspect-provider-security', () => this.docker.containerSecurity(this.names.providerContainerName));
    this.evidence.isolation.providerSecurity = assertContainerSecurity(providerSecurity, this.names.runtimeNetworkName);

    await this.step('start-gateway', () => this.docker.startGateway({
      containerName: this.names.gatewayContainerName,
      networkName: this.names.runtimeNetworkName,
      volumeName: this.names.volumeName,
      gatewayPort: this.gatewayPort,
    }));
    this.evidence.readiness = { initial: await this.step('wait-gateway-readiness', () => waitForGatewayReady(this.docker, this.names.gatewayContainerName)) };
    const runtimeMounts = await this.step('inspect-runtime-mounts', () => this.docker.containerMounts(this.names.gatewayContainerName));
    this.evidence.isolation.runtimeMounts = assertRuntimeMountAllowlist(runtimeMounts, this.names.volumeName);
    const runtimeSecurity = await this.step('inspect-runtime-security', () => this.docker.containerSecurity(this.names.gatewayContainerName));
    this.evidence.isolation.runtimeSecurity = assertContainerSecurity(runtimeSecurity, this.names.runtimeNetworkName, {
      gatewayPort: this.gatewayPort,
      token: this.evidence._token,
    });
    const processList = await this.step('inspect-process-arguments', () => this.docker.processList(this.names.gatewayContainerName));
    this.evidence.isolation.runtimeProcessArguments = assertProcessArgumentsSecure(processList, this.evidence._token);
    const capabilitiesResponse = await this.step('read-capabilities', () => poll(
      'JunQi capabilities',
      () => this.rpc('junqi.collab.capabilities'),
      (value) => Boolean(findRecord(value, (record) => record.pluginId === 'junqi-collab')),
      { timeoutMs: 90_000 },
    ));
    this.capabilities = assertCapabilities(capabilitiesResponse, bundle.metadata);
    const databases = await this.step('discover-collaboration-sqlite', () => this.docker.findCollaborationDatabases(this.names.gatewayContainerName));
    invariant(Array.isArray(databases) && databases.length === 1, 'SQLITE_DISCOVERY_FAILED', 'Expected one collaboration database', { databases });
    this.sqlitePath = databases[0];
    return this.capabilities;
  }

  rpc(method, params = {}) {
    return this.docker.gatewayCall(this.names.gatewayContainerName, method, params);
  }

  async restart(reason) {
    await this.step(`restart-gateway-${reason}`, () => this.docker.restart(this.names.gatewayContainerName));
    this.evidence.readiness[reason] = await this.step(`wait-gateway-${reason}`, () => waitForGatewayReady(this.docker, this.names.gatewayContainerName));
  }

  providerState() {
    return this.docker.containerJsonRequest(
      this.names.providerContainerName,
      `http://127.0.0.1:${PROVIDER_PORT}/debug/state`,
    );
  }

  providerControl(holdKinds) {
    return this.docker.containerJsonRequest(
      this.names.providerContainerName,
      `http://127.0.0.1:${PROVIDER_PORT}/debug/control`,
      { method: 'POST', body: { holdKinds } },
    );
  }

  executeSql(sql) {
    return this.docker.executeSqlite(this.names.gatewayContainerName, this.sqlitePath, sql);
  }

  async runState(runId) {
    return runSnapshot(await this.rpc('junqi.collab.run.get', { runId }));
  }

  waitRun(runId, predicate, description) {
    return poll(description, () => this.runState(runId), predicate);
  }
}

async function createOrigin(fixture, scenarioId, logSentinel) {
  const sessionKey = 'agent:coordinator:main';
  const idempotencyKey = `junqi-behavior-origin-${scenarioId}`;
  const text = `JunQi behavioral origin ${scenarioId} ${logSentinel}`;
  const sent = rpcRecord(
    await fixture.rpc('chat.send', {
      sessionKey,
      agentId: 'coordinator',
      message: text,
      deliver: false,
      timeoutMs: 30_000,
      idempotencyKey,
    }),
    (record) => typeof record.runId === 'string' && typeof record.status === 'string',
    'chat.send',
  );
  await fixture.rpc('agent.wait', { runId: sent.runId, timeoutMs: 45_000 });
  const first = historyPayload(await fixture.rpc('chat.history', { sessionKey, agentId: 'coordinator', limit: 100 }));
  const second = historyPayload(await fixture.rpc('chat.history', { sessionKey, agentId: 'coordinator', limit: 100 }));
  const sessionId = historySessionId(first);
  const secondSessionId = historySessionId(second);
  invariant(sessionId && sessionId === secondSessionId, 'ORIGIN_IDENTITY_UNSTABLE', 'chat.history session identity is not stable');
  const firstMessage = first.messages.find((message) => messageRole(message) === 'user' && messageText(message).includes(text));
  const secondMessage = second.messages.find((message) => messageRole(message) === 'user' && messageText(message).includes(text));
  const nativeMessageId = nativeHistoryMessageId(firstMessage);
  invariant(nativeMessageId && nativeMessageId === nativeHistoryMessageId(secondMessage), 'ORIGIN_IDENTITY_UNSTABLE', 'chat.history message identity is not stable');
  return {
    origin: {
      runtimeId: fixture.capabilities.collaborationInstanceId,
      agentId: 'coordinator',
      sessionKey,
      sessionId,
      nativeMessageId,
      clientMessageId: idempotencyKey,
    },
    evidence: {
      sessionKey,
      sessionId,
      nativeMessageId,
      idempotencyKey,
      repeatedHistoryStable: true,
      chatRunId: sent.runId,
      historyContentShapes: summarizeHistoryContentShapes(first.messages),
    },
  };
}

async function createPlan(fixture, origin, scenarioId, logSentinel) {
  const params = writeEnvelope({
    commandId: `behavior-${scenarioId}-create`,
    expectedCollaborationInstanceId: fixture.capabilities.collaborationInstanceId,
    origin,
    goal: `Verify collaboration behavior for ${scenarioId} ${logSentinel}`,
  });
  const created = acceptedValue(
    await fixture.rpc('junqi.collab.plan.create', params),
    fixture.capabilities.collaborationInstanceId,
  );
  const runId = created.runId;
  return { runId, params, created };
}

async function approvePlan(fixture, snapshot, scenarioId) {
  const assignments = Object.fromEntries(snapshot.workItems.map((item) => [
    item.logicalId,
    item.candidateAgentIds.includes('worker') ? 'worker' : item.candidateAgentIds[0],
  ]));
  invariant(Object.values(assignments).every(Boolean), 'PLAN_ASSIGNMENT_INVALID', 'Planner produced an unassignable work item');
  const params = writeEnvelope({
    commandId: `behavior-${scenarioId}-approve`,
    expectedCollaborationInstanceId: fixture.capabilities.collaborationInstanceId,
    runId: snapshot.run.id,
    planRevisionId: snapshot.run.currentPlanRevisionId,
    expectedRunRevision: snapshot.run.revision,
    assignments,
  });
  const accepted = acceptedValue(
    await fixture.rpc('junqi.collab.plan.approve', params),
    fixture.capabilities.collaborationInstanceId,
  );
  const replay = acceptedValue(
    await fixture.rpc('junqi.collab.plan.approve', params),
    fixture.capabilities.collaborationInstanceId,
  );
  invariant(replay.replayed === true, 'COMMAND_REPLAY_FAILED', 'Approval command replay was not served from its durable receipt');
  invariant(replay.runId === accepted.runId, 'COMMAND_REPLAY_FAILED', 'Approval replay changed run identity');
  return { params, assignments, accepted, replay };
}

async function exactTaskEvidence(fixture, snapshot, options = {}) {
  const attempts = snapshot.attempts.filter((attempt) => attempt.agentRunId || attempt.executionTaskId);
  invariant(attempts.length > 0, 'TASK_BIJECTION_FAILED', 'No OpenClaw-backed attempts were observed');
  const listed = taskList(await fixture.rpc('tasks.list', { limit: 500 }));
  const taskIds = new Set();
  const bindings = [];
  for (const attempt of attempts) {
    invariant(attempt.agentRunId && attempt.executionTaskId, 'TASK_BIJECTION_FAILED', 'Attempt has only a partial Task identity', { attempt });
    const matches = listed.filter((task) => task.runtime === 'subagent'
      && task.ownerKey === attempt.workerOwnerSessionKey
      && task.childSessionKey === attempt.workerSessionKey
      && task.runId === attempt.agentRunId);
    invariant(matches.length === 1, 'TASK_BIJECTION_FAILED', 'Attempt did not map to exactly one persistent subagent Task', {
      attemptId: attempt.id,
      matchCount: matches.length,
    });
    const task = taskValue(await fixture.rpc('tasks.get', { taskId: attempt.executionTaskId }));
    invariant(task.id === matches[0].id, 'TASK_BIJECTION_FAILED', 'tasks.get and tasks.list disagree');
    invariant(!taskIds.has(task.id), 'TASK_BIJECTION_FAILED', 'Multiple JunQi attempts share one Task');
    if (options.requireTerminal !== false) {
      invariant(TERMINAL_TASK_STATUSES.has(task.status), 'TASK_NOT_TERMINAL', 'Expected a terminal persistent Task', { task });
    }
    taskIds.add(task.id);
    bindings.push({
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      attemptStatus: attempt.status,
      taskId: task.id,
      taskStatus: task.status,
      runtime: task.runtime,
      ownerKey: task.ownerKey,
      childSessionKey: task.childSessionKey,
      agentRunId: task.runId,
    });
  }
  return { attemptCount: attempts.length, uniqueTaskCount: taskIds.size, bindings };
}

function isFinalSynthesisMessage(message) {
  return messageText(message).includes('JUNQI_DETERMINISTIC_SYNTHESIS_OK');
}

const PLANNER_IDENTITY_TRIGGER = `
DROP TRIGGER IF EXISTS qa_fail_planner_identity_capture;
CREATE TRIGGER qa_fail_planner_identity_capture
BEFORE UPDATE OF openclaw_run_id ON attempts
WHEN OLD.kind = 'PLANNER'
  AND OLD.openclaw_run_id IS NULL
  AND NEW.openclaw_run_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'qa injected planner identity persistence fault');
END;
`;

const DELIVERY_CONFIRMATION_TRIGGER = `
DROP TRIGGER IF EXISTS qa_fail_delivery_confirmation;
CREATE TRIGGER qa_fail_delivery_confirmation
BEFORE UPDATE OF status ON delivery_attempts
WHEN OLD.status = 'SUBMITTING' AND NEW.status = 'CONFIRMED'
BEGIN
  SELECT RAISE(ABORT, 'qa injected delivery confirmation persistence fault');
END;
`;

async function identityRecoveryScenario(fixture, logSentinel) {
  const scenarioId = 'identity-recovery';
  const origin = await createOrigin(fixture, scenarioId, logSentinel);
  const providerBefore = await fixture.providerState();
  await fixture.executeSql(PLANNER_IDENTITY_TRIGGER);
  const { runId } = await createPlan(fixture, origin.origin, scenarioId, logSentinel);
  const unknown = await fixture.waitRun(
    runId,
    (snapshot) => snapshot.attempts.some((attempt) => attempt.kind === 'PLANNER'
      && attempt.status === 'UNKNOWN'
      && attempt.agentRunId === null),
    'planner identity persistence fault',
  );
  const plannerAttempt = unknown.attempts.find((attempt) => attempt.kind === 'PLANNER');
  const tasksBeforeRestart = taskList(await fixture.rpc('tasks.list', { limit: 500 }));
  const recoveryCandidates = tasksBeforeRestart.filter((task) => task.runtime === 'subagent'
    && task.ownerKey === plannerAttempt.workerOwnerSessionKey
    && task.childSessionKey === plannerAttempt.workerSessionKey);
  invariant(recoveryCandidates.length === 1, 'TASK_RECOVERY_AMBIGUOUS', 'Faulted planner did not leave one recoverable Task', {
    matchCount: recoveryCandidates.length,
  });
  const providerAfterFault = await fixture.providerState();
  invariant(requestDelta(providerBefore, providerAfterFault, 'planner') === 1, 'DUPLICATE_DISPATCH', 'Planner was dispatched more than once before restart');

  await fixture.executeSql('DROP TRIGGER IF EXISTS qa_fail_planner_identity_capture;');
  await fixture.restart('identity-recovery');
  const planned = await fixture.waitRun(
    runId,
    (snapshot) => snapshot.run.status === 'AWAITING_APPROVAL'
      && snapshot.attempts.some((attempt) => attempt.kind === 'PLANNER' && attempt.status === 'SUCCEEDED'),
    'planner Task recovery after Gateway restart',
  );
  const recoveredPlanner = planned.attempts.find((attempt) => attempt.kind === 'PLANNER');
  invariant(recoveredPlanner.executionTaskId === recoveryCandidates[0].id, 'TASK_RECOVERY_CHANGED_IDENTITY', 'Recovered planner bound a different Task');
  const providerAfterRecovery = await fixture.providerState();
  invariant(requestDelta(providerBefore, providerAfterRecovery, 'planner') === 1, 'DUPLICATE_DISPATCH', 'Gateway restart redispatched the planner');

  const approval = await approvePlan(fixture, planned, scenarioId);
  const completed = await fixture.waitRun(runId, (snapshot) => snapshot.run.status === 'COMPLETED', 'identity recovery run completion');
  invariant(completed.finalArtifact?.content?.includes('JUNQI_DETERMINISTIC_SYNTHESIS_OK'), 'FINAL_ARTIFACT_INVALID', 'Final artifact marker is missing');
  invariant(completed.attempts.every((attempt) => attempt.status === 'SUCCEEDED'), 'ATTEMPT_NOT_SUCCEEDED', 'Recovered run has a non-successful attempt');
  const tasks = await exactTaskEvidence(fixture, completed);
  return {
    runId,
    origin: origin.evidence,
    recoveredTask: {
      taskId: recoveryCandidates[0].id,
      runId: recoveryCandidates[0].runId,
      ownerKey: recoveryCandidates[0].ownerKey,
      childSessionKey: recoveryCandidates[0].childSessionKey,
    },
    plannerProviderRequests: requestDelta(providerBefore, providerAfterRecovery, 'planner'),
    approvalReplay: approval.replay.replayed,
    tasks,
  };
}

async function deliveryRecoveryScenario(fixture, logSentinel) {
  const scenarioId = 'delivery-recovery';
  const origin = await createOrigin(fixture, scenarioId, logSentinel);
  const baselineHistory = historyPayload(await fixture.rpc('chat.history', {
    sessionKey: origin.origin.sessionKey,
    agentId: origin.origin.agentId,
    limit: 100,
  }));
  const transcriptDelta = createNativeMessageDeltaSpecification(
    baselineHistory.messages,
    isFinalSynthesisMessage,
  );
  const { runId } = await createPlan(fixture, origin.origin, scenarioId, logSentinel);
  const planned = await fixture.waitRun(runId, (snapshot) => snapshot.run.status === 'AWAITING_APPROVAL', 'delivery scenario planning');
  await fixture.executeSql(DELIVERY_CONFIRMATION_TRIGGER);
  await approvePlan(fixture, planned, scenarioId);
  const unknown = await fixture.waitRun(
    runId,
    (snapshot) => snapshot.run.status === 'DELIVERY_PENDING'
      && snapshot.deliveries.some((delivery) => delivery.status === 'UNKNOWN' && delivery.transcriptStatus === 'UNKNOWN'),
    'delivery acknowledgement persistence fault',
  );
  const beforeHistory = historyPayload(await fixture.rpc('chat.history', {
    sessionKey: origin.origin.sessionKey,
    agentId: origin.origin.agentId,
    limit: 100,
  }));
  const beforeMessage = transcriptDelta.expectExactlyOneAdded(
    beforeHistory.messages,
    'Uncertain delivery did not produce exactly one new transcript message',
  );
  const firstMessageId = nativeHistoryMessageId(beforeMessage);

  await fixture.executeSql('DROP TRIGGER IF EXISTS qa_fail_delivery_confirmation;');
  await fixture.restart('delivery-recovery');
  const completed = await fixture.waitRun(runId, (snapshot) => snapshot.run.status === 'COMPLETED', 'delivery retry after Gateway restart');
  const afterHistory = historyPayload(await fixture.rpc('chat.history', {
    sessionKey: origin.origin.sessionKey,
    agentId: origin.origin.agentId,
    limit: 100,
  }));
  const afterMessage = transcriptDelta.expectExactlyOneAdded(
    afterHistory.messages,
    'Exact transcript retry changed the number of scenario-owned messages',
  );
  invariant(nativeHistoryMessageId(afterMessage) === firstMessageId, 'TRANSCRIPT_IDENTITY_CHANGED', 'Exact transcript retry changed message identity');
  invariant(completed.deliveries.length === 1 && completed.deliveries[0].messageId === firstMessageId, 'DELIVERY_RECEIPT_INVALID', 'Recovered delivery receipt does not bind the original message');
  return {
    runId,
    origin: origin.evidence,
    deliveryId: unknown.deliveries[0].id,
    messageId: firstMessageId,
    transcriptBaselineCount: transcriptDelta.baselineCount,
    transcriptCountBeforeRecovery: 1,
    transcriptCountAfterRecovery: 1,
    deliveryStatus: completed.deliveries[0].status,
  };
}

async function cancellationScenario(fixture, logSentinel) {
  const scenarioId = 'cancellation';
  const origin = await createOrigin(fixture, scenarioId, logSentinel);
  const { runId } = await createPlan(fixture, origin.origin, scenarioId, logSentinel);
  const planned = await fixture.waitRun(runId, (snapshot) => snapshot.run.status === 'AWAITING_APPROVAL', 'cancellation scenario planning');
  await fixture.providerControl(['worker']);
  try {
    await approvePlan(fixture, planned, scenarioId);
    const running = await fixture.waitRun(
      runId,
      (snapshot) => snapshot.attempts.some((attempt) => attempt.kind === 'WORKER'
        && attempt.status === 'RUNNING'
        && attempt.executionTaskId),
      'held worker dispatch',
    );
    const workerAttempt = running.attempts.find((attempt) => attempt.kind === 'WORKER' && attempt.status === 'RUNNING');
    await poll(
      'provider worker request',
      () => fixture.providerState(),
      (state) => state.active >= 1 && state.requests.some((request) => request.kind === 'worker' && request.outcome === 'running'),
      { timeoutMs: 30_000 },
    );
    const runningTask = taskValue(await fixture.rpc('tasks.get', { taskId: workerAttempt.executionTaskId }));
    invariant(runningTask.status === 'running', 'TASK_NOT_RUNNING', 'Held worker Task was not running before cancellation');
    const cancelParams = writeEnvelope({
      commandId: `behavior-${scenarioId}-cancel`,
      expectedCollaborationInstanceId: fixture.capabilities.collaborationInstanceId,
      runId,
      expectedRunRevision: running.run.revision,
    });
    acceptedValue(
      await fixture.rpc('junqi.collab.run.cancel', cancelParams),
      fixture.capabilities.collaborationInstanceId,
    );
    const cancelled = await fixture.waitRun(
      runId,
      (snapshot) => snapshot.run.status === 'CANCELLED'
        && snapshot.attempts.every((attempt) => TERMINAL_ATTEMPT_STATUSES.has(attempt.status)),
      'run cancellation closure',
    );
    const terminalTask = await poll(
      'worker Task cancellation',
      () => fixture.rpc('tasks.get', { taskId: workerAttempt.executionTaskId }).then(taskValue),
      (task) => TERMINAL_TASK_STATUSES.has(task.status),
      { timeoutMs: 60_000 },
    );
    const provider = await poll(
      'provider request cancellation',
      () => fixture.providerState(),
      (state) => state.requests.some((request) => request.kind === 'worker' && request.outcome === 'aborted'),
      { timeoutMs: 60_000 },
    );
    return {
      runId,
      origin: origin.evidence,
      attemptId: workerAttempt.id,
      taskId: terminalTask.id,
      taskStatus: terminalTask.status,
      runStatus: cancelled.run.status,
      activeAttemptCount: cancelled.attempts.filter((attempt) => !TERMINAL_ATTEMPT_STATUSES.has(attempt.status)).length,
      providerAbortedWorkerRequests: provider.requests.filter((request) => request.kind === 'worker' && request.outcome === 'aborted').length,
    };
  } finally {
    await fixture.providerControl([]).catch(() => {});
  }
}

function scopeClaims() {
  const pending = (summary) => ({ status: 'NOT_RUN', summary });
  return {
    'P0-01': { status: 'NOT_IN_SCOPE', reason: 'Covered by the separate structural real-Gateway gate.' },
    'P0-02': pending('Repeated real chat.history reads must produce stable session and native message identities tied to the chat idempotency key.'),
    'P0-03': pending('A real exact transcript append must survive acknowledgement loss without creating a duplicate message.'),
    'P0-04': { status: 'NOT_VERIFIED', reason: 'Session reset race injection is intentionally excluded from this harness.' },
    'P0-05': pending('Every JunQi OpenClaw-backed Attempt must map bijectively to one persistent runtime=subagent Task.'),
    'P0-06': pending('A restarted Gateway must recover the unique Task by owner and child session identity after identity persistence loss.'),
    'P0-07': pending('Cancelling a Run must terminate the held real worker Task and close every Attempt.'),
    'P0-08': pending('Gateway restart must recover the existing Task without a second dispatch.'),
    'P0-09': { status: 'NOT_IN_SCOPE', reason: 'Requires real Desktop exit and external runtime continuity.' },
    'P0-10': { status: 'NOT_IN_SCOPE', reason: 'Requires real Desktop managed-child topology.' },
    'P0-11': { status: 'NOT_IN_SCOPE', reason: 'Portable plugin registration is covered structurally; trusted-only negative probes are separate.' },
    'P0-12': { status: 'NOT_IN_SCOPE', reason: 'Workboard capability reporting is covered by the structural gate.' },
    'P0-13': { status: 'NOT_IN_SCOPE', reason: 'Requires Desktop reset/delete UI enforcement.' },
    'P0-14': { status: 'NOT_IN_SCOPE', reason: 'Requires a no-plugin Gateway, exact Desktop target/connection attestation, and durable-state absence probes.' },
  };
}

function markClaimsVerified(evidence, claimIds, scenario) {
  for (const claimId of claimIds) {
    const current = evidence.claims[claimId];
    invariant(current?.status === 'NOT_RUN', 'EVIDENCE_STATE_INVALID', `${claimId} cannot be verified from its current state`);
    evidence.claims[claimId] = {
      ...current,
      status: 'VERIFIED',
      scenario,
      verifiedAt: new Date().toISOString(),
    };
  }
}

export function validateBehavioralEvidence(evidence) {
  invariant(evidence.formatVersion === BEHAVIORAL_EVIDENCE_FORMAT_VERSION, 'EVIDENCE_INVALID', 'Unexpected behavioral evidence version');
  invariant(evidence.kind === 'JUNQI_COLLABORATION_REAL_GATEWAY_BEHAVIORAL', 'EVIDENCE_INVALID', 'Unexpected evidence kind');
  invariant(evidence.scope === 'ISOLATED_REAL_GATEWAY_BEHAVIORAL_P0_AUTOMATED', 'EVIDENCE_INVALID', 'Behavioral evidence scope is not explicit');
  for (const id of ['P0-02', 'P0-03', 'P0-05', 'P0-06', 'P0-07', 'P0-08']) {
    invariant(evidence.claims?.[id]?.status === 'VERIFIED', 'EVIDENCE_INVALID', `${id} was not verified`);
  }
  for (const id of ['P0-04', 'P0-09', 'P0-10', 'P0-13', 'P0-14']) {
    invariant(evidence.claims?.[id]?.status !== 'VERIFIED', 'EVIDENCE_SCOPE_OVERCLAIM', `${id} must not be claimed by this harness`);
  }
  invariant(evidence.isolation.runtimeNetworkInternal === true, 'EVIDENCE_INVALID', 'Behavioral runtime network was not internal');
  invariant(evidence.isolation.hostPortPublished === false, 'EVIDENCE_INVALID', 'Behavioral harness published a host port');
  invariant(evidence.provider.externalApiKeyUsed === false, 'EVIDENCE_INVALID', 'Behavioral harness used an external API key');
  invariant(evidence.provider.promptContentPersisted === false, 'EVIDENCE_INVALID', 'Provider evidence persisted prompt content');
  invariant(evidence.logPrivacy?.policy === GATEWAY_EVIDENCE_LOG_POLICY, 'EVIDENCE_INVALID', 'Gateway log privacy policy is missing');
  invariant(/^[a-f0-9]{64}$/.test(evidence.logPrivacy?.sentinelSha256 ?? ''), 'EVIDENCE_INVALID', 'Gateway log privacy sentinel digest is missing');
  invariant(evidence.logPrivacy?.modelOutputPersisted === false, 'EVIDENCE_INVALID', 'Gateway evidence persisted model output');
  invariant(evidence.logPrivacy?.privateFragmentCount === 0, 'EVIDENCE_INVALID', 'Gateway evidence persisted a private harness fragment');
  invariant(evidence.logPrivacy?.providerPrivateFragmentCount === 0, 'EVIDENCE_INVALID', 'Provider evidence persisted a private harness fragment');
  invariant(evidence.logPrivacy?.failurePrivateFragmentCount === 0, 'EVIDENCE_INVALID', 'Failure evidence persisted a private harness fragment');
  invariant(
    Number.isSafeInteger(evidence.logPrivacy?.redactedLineCount) && evidence.logPrivacy.redactedLineCount > 0,
    'EVIDENCE_INVALID',
    'Gateway log privacy policy did not redact any model-output lines',
  );
  return evidence;
}

export async function runBehavioralGatewayVerification(options = {}) {
  const runId = options.runId ?? createSmokeRunId();
  const logSentinel = `JUNQI_LOG_SENTINEL_${randomBytes(16).toString('hex')}`;
  const names = {
    ...collaborationResourceNames(runId),
    providerContainerName: `junqi-collab-smoke-${runId}-provider`.toLowerCase(),
  };
  const token = options.tokenFactory?.() ?? randomBytes(32).toString('hex');
  invariant(/^[a-f0-9]{64}$/.test(token), 'TOKEN_INVALID', 'Gateway token must be a 32-byte lowercase hexadecimal secret');
  const evidenceRoot = options.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT;
  const evidenceDirectory = path.join(evidenceRoot, runId);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await mkdir(evidenceDirectory, { recursive: false, mode: 0o700 });
  const evidencePath = path.join(evidenceDirectory, 'evidence.json');
  const gatewayLogPath = path.join(evidenceDirectory, 'gateway.log');
  const providerLogPath = path.join(evidenceDirectory, 'provider.log');
  const failureLogPath = path.join(evidenceDirectory, 'failure.log');
  const requestedProviderSourcePath = options.providerSourcePath ?? PROVIDER_SOURCE_PATH;
  const providerSourceStat = await lstat(requestedProviderSourcePath);
  invariant(providerSourceStat.isFile(), 'PROVIDER_SOURCE_INVALID', 'Deterministic provider source is not a regular file');
  invariant(!providerSourceStat.isSymbolicLink(), 'PROVIDER_SOURCE_INVALID', 'Deterministic provider source must not be a symbolic link');
  const providerSourcePath = await realpath(requestedProviderSourcePath);
  const gatewayPort = options.gatewayPortFactory?.() ?? allocateRandomGatewayPort();
  invariant(gatewayPort !== DEFAULT_USER_GATEWAY_PORT, 'GATEWAY_PORT_INVALID', 'Behavioral Gateway must not use the user default port');
  const providerBytes = await readFile(providerSourcePath);
  let evidence = {
    formatVersion: BEHAVIORAL_EVIDENCE_FORMAT_VERSION,
    kind: 'JUNQI_COLLABORATION_REAL_GATEWAY_BEHAVIORAL',
    scope: 'ISOLATED_REAL_GATEWAY_BEHAVIORAL_P0_AUTOMATED',
    status: 'RUNNING',
    runId,
    startedAt: new Date().toISOString(),
    image: {
      reference: OFFICIAL_OPENCLAW_IMAGE,
      version: OFFICIAL_OPENCLAW_VERSION,
      digest: OFFICIAL_OPENCLAW_IMAGE_DIGEST,
    },
    provider: {
      model: MODEL_REFERENCE,
      sourceSha256: sha256(providerBytes),
      sourceDestination: DETERMINISTIC_PROVIDER_DESTINATION,
      externalApiKeyUsed: false,
      localMarkerCredential: true,
      promptContentPersisted: false,
    },
    logPrivacy: {
      policy: GATEWAY_EVIDENCE_LOG_POLICY,
      sentinelSha256: sha256(logSentinel),
      modelOutputPersisted: null,
      privateFragmentCount: null,
      providerPrivateFragmentCount: null,
      failurePrivateFragmentCount: null,
      totalLineCount: null,
      preservedLineCount: null,
      redactedLineCount: null,
    },
    isolation: {
      userProfileAccessAllowed: false,
      devModeAllowed: false,
      runtimeNetworkInternal: true,
      hostPortPublished: false,
      defaultUserGatewayPort: DEFAULT_USER_GATEWAY_PORT,
      isolatedGatewayPort: gatewayPort,
    },
    resources: {
      volume: names.volumeName,
      setupNetwork: names.setupNetworkName,
      runtimeNetwork: names.runtimeNetworkName,
      gatewayContainer: names.gatewayContainerName,
      providerContainer: names.providerContainerName,
    },
    claims: scopeClaims(),
    scenarios: {},
    steps: [],
    cleanup: { actions: [], errors: [] },
  };
  Object.defineProperty(evidence, '_token', { value: token, enumerable: false });
  const resources = {
    ...names,
    bootstrapContainerNames: new Set(),
    sidecarContainerNames: new Set(),
  };
  const secrets = [token];
  let docker = options.dockerRuntime;
  let fixture;
  let primaryError;
  let gatewayLogs = '';
  let providerLogs = '';
  const step = async (id, operation) => {
    const startedAt = Date.now();
    try {
      const result = await operation();
      evidence.steps.push({ id, status: 'PASSED', durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      evidence.steps.push({ id, status: 'FAILED', durationMs: Date.now() - startedAt });
      throw error;
    }
  };

  try {
    const bundle = options.bundle ?? await step('validate-bundle', () => loadAndValidateBundle());
    if (options.bundle) evidence.steps.push({ id: 'validate-bundle', status: 'PASSED', durationMs: 0, injected: true });
    evidence.bundle = {
      pluginId: bundle.metadata.pluginId,
      pluginVersion: bundle.metadata.pluginVersion,
      schemaVersion: bundle.metadata.schemaVersion,
      sha256: bundle.metadata.sha256,
    };
    docker ??= new DockerRuntime({ token, runId, dockerBinary: options.dockerBinary, runner: options.runner });
    evidence.docker = await step('docker-preflight', () => docker.preflight());
    evidence.image.inspection = await step('pull-pinned-image', () => docker.pullImage());
    fixture = new BehavioralGatewayFixture({
      docker, names, resources, runId, gatewayPort, providerSourcePath, evidence, step,
    });
    const capabilities = await fixture.start(bundle);
    evidence.capabilities = {
      collaborationInstanceId: capabilities.collaborationInstanceId,
      runtimeVersion: capabilities.runtimeVersion,
      trustTier: capabilities.trustTier,
      workboard: capabilities.workboard,
    };

    evidence.scenarios.deliveryRecovery = await step('scenario-delivery-recovery', () => deliveryRecoveryScenario(fixture, logSentinel));
    markClaimsVerified(evidence, ['P0-03'], 'deliveryRecovery');
    evidence.scenarios.cancellation = await step('scenario-cancellation', () => cancellationScenario(fixture, logSentinel));
    markClaimsVerified(evidence, ['P0-07'], 'cancellation');
    evidence.scenarios.identityRecovery = await step('scenario-identity-recovery', () => identityRecoveryScenario(fixture, logSentinel));
    markClaimsVerified(evidence, ['P0-02', 'P0-05', 'P0-06', 'P0-08'], 'identityRecovery');
    const providerState = await step('collect-provider-state', () => fixture.providerState());
    invariant(providerState.active === 0, 'PROVIDER_REQUEST_LEAK', 'Provider still has active requests after scenarios', { providerState });
    invariant(providerCompletedCount(providerState, 'planner') >= 3, 'PROVIDER_AUDIT_INVALID', 'Provider did not observe all planners');
    evidence.provider.audit = providerState;
    evidence.status = 'PASSED';
    evidence.completedAt = new Date().toISOString();
  } catch (error) {
    primaryError = error;
    evidence.status = 'FAILED';
    evidence.completedAt = new Date().toISOString();
    evidence.failure = safeBehavioralErrorForEvidence(error, secrets);
  } finally {
    if (fixture) await fixture.providerControl([]).catch(() => {});
    if (docker) {
      gatewayLogs = await docker.logs(names.gatewayContainerName).catch((error) => `Unable to read Gateway logs: ${error.message}`);
      providerLogs = await docker.logs(names.providerContainerName).catch((error) => `Unable to read provider logs: ${error.message}`);
      evidence.cleanup = await cleanupResources(docker, resources);
      evidence.cleanup.errors = evidence.cleanup.errors.map(({ kind, name, error }) => ({
        kind,
        name,
        error: safeBehavioralErrorForEvidence(error, secrets),
      }));
    }
    if (evidence.cleanup.errors.length > 0 && !primaryError) {
      primaryError = new SmokeInvariantError('RESOURCE_CLEANUP_FAILED', 'Behavioral verification cleanup was incomplete', {
        errors: evidence.cleanup.errors,
      });
      evidence.status = 'FAILED';
      evidence.failure = safeBehavioralErrorForEvidence(primaryError, secrets);
    }
    const redactedGatewayLogs = redactSensitive(gatewayLogs, secrets);
    const redactedProviderLogs = redactSensitive(providerLogs, secrets);
    const sanitizedGatewayLogs = sanitizeGatewayEvidenceLog(redactedGatewayLogs, {
      privateFragments: [...PRIVATE_GATEWAY_LOG_FRAGMENTS, logSentinel],
    });
    const sanitizedProviderLogs = sanitizeGatewayEvidenceLog(redactedProviderLogs, {
      privateFragments: [logSentinel],
    });
    const failureText = evidence.failure ? `${JSON.stringify(evidence.failure)}\n` : '';
    let sanitizedFailure = sanitizeGatewayEvidenceLog(failureText, {
      privateFragments: [logSentinel],
    });
    evidence.logPrivacy = {
      policy: sanitizedGatewayLogs.policy,
      sentinelSha256: sha256(logSentinel),
      modelOutputPersisted: false,
      privateFragmentCount: sanitizedGatewayLogs.privateFragmentCount,
      providerPrivateFragmentCount: sanitizedProviderLogs.privateFragmentCount,
      failurePrivateFragmentCount: sanitizedFailure.privateFragmentCount,
      totalLineCount: sanitizedGatewayLogs.totalLineCount,
      preservedLineCount: sanitizedGatewayLogs.preservedLineCount,
      redactedLineCount: sanitizedGatewayLogs.redactedLineCount,
    };
    if (!primaryError) {
      try {
        validateBehavioralEvidence(evidence);
      } catch (error) {
        primaryError = error;
        evidence.status = 'FAILED';
        evidence.failure = safeBehavioralErrorForEvidence(error, secrets);
        sanitizedFailure = sanitizeGatewayEvidenceLog(`${JSON.stringify(evidence.failure)}\n`, {
          privateFragments: [logSentinel],
        });
      }
    }
    const privateFragments = [...PRIVATE_GATEWAY_LOG_FRAGMENTS, logSentinel];
    if (privateFragments.some((fragment) => JSON.stringify(evidence).includes(fragment))) {
      primaryError ??= new SmokeInvariantError(
        'EVIDENCE_PRIVACY_VIOLATION',
        'Evidence contained a private harness fragment and was reduced to payload-free failure metadata',
      );
      evidence = {
        formatVersion: BEHAVIORAL_EVIDENCE_FORMAT_VERSION,
        kind: 'JUNQI_COLLABORATION_REAL_GATEWAY_BEHAVIORAL',
        scope: 'ISOLATED_REAL_GATEWAY_BEHAVIORAL_P0_AUTOMATED',
        status: 'FAILED',
        runId,
        startedAt: evidence.startedAt,
        completedAt: evidence.completedAt,
        failure: {
          category: 'EVIDENCE_PRIVACY_VIOLATION',
          code: 'EVIDENCE_PRIVACY_VIOLATION',
        },
        logPrivacy: evidence.logPrivacy,
        cleanup: { actions: [], errors: [] },
      };
      sanitizedFailure = sanitizeGatewayEvidenceLog(`${JSON.stringify(evidence.failure)}\n`, {
        privateFragments,
      });
    }
    await Promise.all([
      writeFile(gatewayLogPath, sanitizedGatewayLogs.text, { mode: 0o600 }),
      writeFile(providerLogPath, sanitizedProviderLogs.text, { mode: 0o600 }),
      primaryError ? writeFile(failureLogPath, sanitizedFailure.text, { mode: 0o600 }) : Promise.resolve(),
    ]);
    await writeJsonAtomic(evidencePath, evidence);
  }

  if (primaryError) throw new BehavioralGatewayFailure(`Behavioral Gateway verification failed; evidence: ${evidencePath}`, evidencePath);
  return { evidence, evidencePath, gatewayLogPath, providerLogPath };
}

export function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--evidence-root') {
      const value = argv[++index];
      invariant(value, 'CLI_ARGUMENT_INVALID', '--evidence-root requires a value');
      options.evidenceRoot = path.resolve(value);
      continue;
    }
    if (argument === '--docker') {
      const value = argv[++index];
      invariant(value, 'CLI_ARGUMENT_INVALID', '--docker requires a value');
      options.dockerBinary = value;
      continue;
    }
    throw new SmokeInvariantError('CLI_ARGUMENT_INVALID', `Unknown argument: ${argument}`);
  }
  return options;
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    const result = await runBehavioralGatewayVerification(parseCliArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: 'PASSED', evidencePath: result.evidencePath })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
