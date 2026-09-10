#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  CONTAINER_HOME,
  DEFAULT_USER_GATEWAY_PORT,
  DockerRuntime,
  EVIDENCE_FORMAT_VERSION,
  OFFICIAL_OPENCLAW_IMAGE,
  OFFICIAL_OPENCLAW_IMAGE_DIGEST,
  OFFICIAL_OPENCLAW_VERSION,
  SmokeInvariantError,
  StructuralSmokeFailure,
  allocateRandomGatewayPort,
  assertContainerSecurity,
  assertInstallMountAllowlist,
  assertNetworkInspection,
  assertProcessArgumentsSecure,
  assertRuntimeMountAllowlist,
  buildGatewayRunArgs,
  cleanupResources,
  createSmokeRunId,
  errorForEvidence,
  parseJsonOutput,
  redactSensitive,
  sha256,
  waitForGatewayReady,
  writeJsonAtomic,
} from './verify-collaboration-real-gateway.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const RESOURCE_METADATA_PATH = path.join(
  REPOSITORY_ROOT,
  'src-tauri',
  'resources',
  'dingtalk',
  'metadata.json',
);
const GENERATED_METADATA_PATH = path.join(
  REPOSITORY_ROOT,
  'src',
  'generated',
  'dingtalkPluginBundle.generated.json',
);
const RESOURCE_ARCHIVE_PATH = path.join(
  REPOSITORY_ROOT,
  'src-tauri',
  'resources',
  'dingtalk',
  'junqi-dingtalk.tgz',
);
const DEFAULT_EVIDENCE_ROOT = path.join(
  REPOSITORY_ROOT,
  '.artifacts',
  'dingtalk-real-gateway',
);
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const READY_TIMEOUT_MS = 90_000;
const EVENT_SNAPSHOT_METHOD = 'junqi.dingtalk.events.snapshot';
const EVENT_SNAPSHOT_PARAMS = Object.freeze({ afterSequence: 0, limit: 20 });
const EXPECTED_EVENT_CONFIGURATION_DIGEST = createHash('sha256')
  .update(JSON.stringify([null, 100, []]))
  .digest('hex');
const FIXTURE_DWS_SOURCE_PATH = path.join(
  SCRIPT_DIRECTORY,
  'fixtures',
  'dingtalk-gateway-dws-fixture.js',
);
const FIXTURE_PROFILE = 'smoke:test-user';
const FIXTURE_TOOL_NAME = 'junqi_dingtalk_contact_me';
const FIXTURE_CANONICAL_PATH = 'contact.get_current_user_profile';
const FIXTURE_DATA = Object.freeze({
  fixture: 'junqi-dingtalk-gateway-chain',
  userId: 'test-user',
});

export const DINGTALK_ARCHIVE_DESTINATION = '/run/junqi-input/junqi-dingtalk.tgz';
export const DINGTALK_DWS_FIXTURE_DESTINATION = '/run/junqi-input/dingtalk-gateway-dws-fixture.js';

function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new SmokeInvariantError(code, message, details);
}

async function assertRegularFile(filePath, field) {
  const fileStat = await stat(filePath);
  invariant(fileStat.isFile(), 'BUNDLE_FILE_INVALID', `${field} is not a regular file`, { filePath });
}

function assertMetadataShape(metadata) {
  invariant(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'BUNDLE_METADATA_INVALID', 'DingTalk bundle metadata must be an object');
  invariant(metadata.formatVersion === 1, 'BUNDLE_METADATA_INVALID', 'Unexpected DingTalk bundle metadata format');
  invariant(metadata.pluginId === 'junqi-dingtalk', 'BUNDLE_METADATA_INVALID', 'Unexpected DingTalk plugin id');
  invariant(metadata.packageName === '@junqi/openclaw-dingtalk-business', 'BUNDLE_METADATA_INVALID', 'Unexpected DingTalk package name');
  invariant(typeof metadata.pluginVersion === 'string' && /^\d+\.\d+\.\d+$/.test(metadata.pluginVersion), 'BUNDLE_METADATA_INVALID', 'Invalid DingTalk plugin version');
  invariant(Number.isSafeInteger(metadata.toolCount) && metadata.toolCount >= 4, 'BUNDLE_METADATA_INVALID', 'Invalid DingTalk tool count');
  invariant(typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.sha256), 'BUNDLE_METADATA_INVALID', 'Invalid DingTalk archive SHA-256');
  invariant(metadata.archiveFile === 'junqi-dingtalk.tgz', 'BUNDLE_METADATA_INVALID', 'Unexpected DingTalk archive file');
  invariant(metadata.resourcePath === 'dingtalk/junqi-dingtalk.tgz', 'BUNDLE_METADATA_INVALID', 'Unexpected DingTalk archive resource path');
}

export async function loadAndValidateDingTalkBundle(options = {}) {
  const resourceMetadataPath = options.resourceMetadataPath ?? RESOURCE_METADATA_PATH;
  const generatedMetadataPath = options.generatedMetadataPath ?? GENERATED_METADATA_PATH;
  const resourceArchivePath = options.resourceArchivePath ?? RESOURCE_ARCHIVE_PATH;
  await Promise.all([
    assertRegularFile(resourceMetadataPath, 'resource metadata'),
    assertRegularFile(generatedMetadataPath, 'generated metadata'),
    assertRegularFile(resourceArchivePath, 'resource archive'),
  ]);
  const [resourceMetadataBytes, generatedMetadataBytes, archiveBytes] = await Promise.all([
    readFile(resourceMetadataPath),
    readFile(generatedMetadataPath),
    readFile(resourceArchivePath),
  ]);
  invariant(resourceMetadataBytes.equals(generatedMetadataBytes), 'BUNDLE_METADATA_DIVERGED', 'DingTalk resource and generated metadata are not byte-identical');
  let metadata;
  try {
    metadata = JSON.parse(resourceMetadataBytes.toString('utf8'));
  } catch (error) {
    throw new SmokeInvariantError('BUNDLE_METADATA_INVALID', 'DingTalk bundle metadata is not valid JSON', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  assertMetadataShape(metadata);
  const actualHash = sha256(archiveBytes);
  invariant(actualHash === metadata.sha256, 'BUNDLE_HASH_MISMATCH', 'DingTalk resource archive does not match metadata', {
    expected: metadata.sha256,
    actual: actualHash,
  });
  const packedArchivePath = options.packedArchivePath ?? path.join(
    REPOSITORY_ROOT,
    'packages',
    'junqi-dingtalk',
    'dist',
    `junqi-openclaw-dingtalk-business-${metadata.pluginVersion}.tgz`,
  );
  await assertRegularFile(packedArchivePath, 'packed archive');
  const packedArchiveBytes = await readFile(packedArchivePath);
  invariant(packedArchiveBytes.equals(archiveBytes), 'BUNDLE_ARCHIVE_DIVERGED', 'Packed and Tauri DingTalk archives are not byte-identical');
  const resolvedArchivePath = await realpath(resourceArchivePath);
  const resolvedRoot = await realpath(options.repositoryRoot ?? REPOSITORY_ROOT);
  const relativeArchive = path.relative(resolvedRoot, resolvedArchivePath);
  invariant(
    relativeArchive !== '..'
      && !relativeArchive.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeArchive),
    'BUNDLE_PATH_INVALID',
    'DingTalk archive resolves outside the repository',
  );
  return {
    metadata,
    archivePath: resolvedArchivePath,
    archiveSize: archiveBytes.byteLength,
    metadataPath: resourceMetadataPath,
  };
}

export function assertDisabledDingTalkSnapshot(value, options = {}) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk event snapshot must be an object');
  const expectedKeys = [
    'activeConsumerCount',
    'configurationDigest',
    'configured',
    'contractDigest',
    'droppedCount',
    'eventKeys',
    'events',
    'lastErrorCode',
    'latestSequence',
    'oldestSequence',
    'phase',
    'profileRef',
    'readyConsumerCount',
    'rejectedCount',
    'runtimeGeneration',
    'subscriptionCount',
  ];
  invariant(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys),
    'DINGTALK_SNAPSHOT_INVALID',
    'DingTalk event snapshot fields do not match the closed RPC contract',
  );
  invariant(typeof value.runtimeGeneration === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runtimeGeneration), 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk runtime generation is not UUID v4');
  invariant(value.configurationDigest === EXPECTED_EVENT_CONFIGURATION_DIGEST, 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk disabled event configuration digest is wrong');
  invariant(value.configured === false && value.phase === 'disabled', 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk event runtime is not disabled');
  invariant(value.profileRef === null && value.contractDigest === null, 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk disabled snapshot leaked a profile or DWS contract');
  for (const field of ['subscriptionCount', 'activeConsumerCount', 'readyConsumerCount', 'latestSequence', 'droppedCount', 'rejectedCount']) {
    invariant(value[field] === 0, 'DINGTALK_SNAPSHOT_INVALID', `DingTalk disabled snapshot ${field} must be zero`);
  }
  invariant(value.oldestSequence === null && value.lastErrorCode === null, 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk disabled snapshot contains unexpected status');
  invariant(Array.isArray(value.eventKeys) && value.eventKeys.length === 0, 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk disabled snapshot contains event keys');
  invariant(Array.isArray(value.events) && value.events.length === 0, 'DINGTALK_SNAPSHOT_INVALID', 'DingTalk disabled snapshot contains events');
  if (options.previousGeneration !== undefined) {
    invariant(value.runtimeGeneration !== options.previousGeneration, 'DINGTALK_RUNTIME_GENERATION_STALE', 'DingTalk runtime generation did not change after Gateway restart');
  }
  return value;
}

export function assertNoDwsProcess(processList) {
  const output = String(processList ?? '');
  invariant(output.trim().length > 0, 'PROCESS_INSPECTION_INVALID', 'docker top returned no process rows');
  invariant(!/(?:^|[\s/])dws(?:\.js)?(?:\s|$)/im.test(output), 'DWS_PROCESS_UNEXPECTED', 'DWS process started during disabled-runtime smoke');
  return { dwsProcessRows: 0 };
}

export function assertScopedReadSuccess(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'DINGTALK_SCOPE_PROBE_INVALID', 'Scoped Gateway response must be an object');
  invariant(value.ok === true, 'DINGTALK_READ_SCOPE_FAILED', 'operator.read did not authorize the DingTalk snapshot RPC');
  invariant(Object.hasOwn(value, 'result'), 'DINGTALK_SCOPE_PROBE_INVALID', 'Successful scoped Gateway response is missing its result');
  return value.result;
}

export function assertWriteOnlyScopeDenied(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'DINGTALK_SCOPE_PROBE_INVALID', 'Scoped Gateway response must be an object');
  invariant(value.ok === false, 'DINGTALK_SCOPE_BOUNDARY_FAILED', 'operator.write unexpectedly authorized the DingTalk read RPC');
  invariant(value.error?.code === 'FORBIDDEN', 'DINGTALK_SCOPE_BOUNDARY_FAILED', 'DingTalk read RPC denial did not use the FORBIDDEN code');
  invariant(value.error?.details?.code === 'MISSING_SCOPE', 'DINGTALK_SCOPE_BOUNDARY_FAILED', 'DingTalk read RPC denial did not include MISSING_SCOPE details');
  invariant(value.error.details.missingScope === 'operator.read', 'DINGTALK_SCOPE_BOUNDARY_FAILED', 'DingTalk read RPC denial named the wrong missing scope');
  invariant(
    JSON.stringify(value.error.details.requiredScopes) === JSON.stringify(['operator.read']),
    'DINGTALK_SCOPE_BOUNDARY_FAILED',
    'DingTalk read RPC denial reported unexpected required scopes',
  );
  return {
    code: value.error.code,
    details: value.error.details,
  };
}

export function assertDingTalkEffectiveReadTool(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'DINGTALK_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory must be an object');
  invariant(value.agentId === 'main', 'DINGTALK_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory resolved the wrong agent');
  invariant(Array.isArray(value.groups), 'DINGTALK_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory groups are missing');
  const pluginTools = value.groups
    .filter((group) => group?.source === 'plugin' && Array.isArray(group.tools))
    .flatMap((group) => group.tools);
  const matches = pluginTools.filter((tool) => tool?.id === FIXTURE_TOOL_NAME);
  invariant(matches.length === 1, 'DINGTALK_EFFECTIVE_TOOL_MISSING', 'Effective inventory must contain exactly one DingTalk current-user tool');
  const tool = matches[0];
  invariant(tool.source === 'plugin', 'DINGTALK_EFFECTIVE_TOOLS_INVALID', 'DingTalk current-user tool has the wrong source');
  invariant(tool.pluginId === 'junqi-dingtalk', 'DINGTALK_EFFECTIVE_TOOLS_INVALID', 'DingTalk current-user tool has the wrong plugin owner');
  invariant(tool.deniedBySession !== true, 'DINGTALK_EFFECTIVE_TOOL_DENIED', 'DingTalk current-user tool is denied by the isolated session');
  return {
    agentId: value.agentId,
    toolName: tool.id,
    pluginId: tool.pluginId,
  };
}

export function assertDingTalkFixtureReadInvocation(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'DINGTALK_TOOL_INVOKE_INVALID', 'DingTalk tools.invoke result must be an object');
  invariant(value.ok === true, 'DINGTALK_TOOL_INVOKE_FAILED', 'DingTalk current-user tool did not succeed');
  invariant(value.toolName === FIXTURE_TOOL_NAME, 'DINGTALK_TOOL_INVOKE_INVALID', 'DingTalk tools.invoke returned the wrong tool name');
  invariant(value.source === 'plugin', 'DINGTALK_TOOL_INVOKE_INVALID', 'DingTalk tools.invoke returned the wrong source');
  const output = value.output;
  invariant(output && typeof output === 'object' && !Array.isArray(output), 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool output must be an object');
  const details = output.details;
  invariant(details && typeof details === 'object' && !Array.isArray(details), 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details must be an object');
  invariant(details.success === true, 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details did not report success');
  invariant(details.toolName === FIXTURE_TOOL_NAME, 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned the wrong tool name');
  invariant(details.dwsCanonicalPath === FIXTURE_CANONICAL_PATH, 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned the wrong DWS canonical path');
  invariant(details.profileRef === FIXTURE_PROFILE, 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned the wrong Profile reference');
  invariant(typeof details.schemaDigest === 'string' && /^[a-f0-9]{64}$/.test(details.schemaDigest), 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned an invalid Schema digest');
  invariant(
    typeof details.observedAt === 'string'
      && !Number.isNaN(Date.parse(details.observedAt))
      && new Date(details.observedAt).toISOString() === details.observedAt,
    'DINGTALK_TOOL_OUTPUT_INVALID',
    'DingTalk tool details returned an invalid observation time',
  );
  invariant(JSON.stringify(details.data) === JSON.stringify(FIXTURE_DATA), 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned an unexpected fixture payload');
  invariant(Array.isArray(output.content) && output.content.length === 1, 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool output content must contain one item');
  invariant(output.content[0]?.type === 'text', 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool output content must be text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(output.content[0].text);
  } catch {
    throw new SmokeInvariantError('DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool text content is not valid JSON');
  }
  invariant(JSON.stringify(contentDetails) === JSON.stringify(details), 'DINGTALK_TOOL_OUTPUT_INVALID', 'DingTalk tool text content differs from details');
  return {
    toolName: value.toolName,
    source: value.source,
    schemaDigest: details.schemaDigest,
  };
}

export function assertDwsFixtureRuntimeMountAllowlist(mounts, volumeName, fixturePath) {
  invariant(Array.isArray(mounts) && mounts.length === 2, 'MOUNT_ALLOWLIST_FAILED', 'Gateway fixture runtime has unexpected mounts');
  const homeMount = mounts.find((mount) => mount.Destination === CONTAINER_HOME);
  const fixtureMount = mounts.find((mount) => mount.Destination === DINGTALK_DWS_FIXTURE_DESTINATION);
  invariant(homeMount?.Type === 'volume' && homeMount.Name === volumeName && homeMount.RW === true, 'MOUNT_ALLOWLIST_FAILED', 'Gateway fixture home mount is invalid');
  invariant(fixtureMount?.Type === 'bind' && fixtureMount.RW === false, 'MOUNT_ALLOWLIST_FAILED', 'Gateway DWS fixture mount is not read-only');
  const expectedSource = path.resolve(fixturePath);
  const inspectedSource = path.resolve(fixtureMount.Source);
  const dockerDesktopSources = [
    path.posix.normalize(`/host_mnt${expectedSource}`),
    path.posix.normalize(`/run/desktop/mnt/host${expectedSource}`),
  ];
  invariant(
    inspectedSource === expectedSource || dockerDesktopSources.includes(inspectedSource),
    'MOUNT_ALLOWLIST_FAILED',
    'Gateway DWS fixture source is wrong',
  );
  return mounts.map((mount) => ({
    type: mount.Type,
    name: mount.Name ?? null,
    destination: mount.Destination,
    readWrite: mount.RW === true,
  }));
}

export class DingTalkDockerRuntime extends DockerRuntime {
  async startGateway(options) {
    if (!options.dwsFixturePath) return await super.startGateway(options);
    invariant(path.isAbsolute(options.dwsFixturePath), 'DWS_FIXTURE_PATH_INVALID', 'DWS fixture path must be absolute');
    invariant(!options.dwsFixturePath.includes(','), 'DWS_FIXTURE_PATH_INVALID', 'DWS fixture path cannot contain a comma');
    const args = buildGatewayRunArgs({
      ...options,
      runId: this.runId,
      kind: 'gateway',
    });
    const imageIndex = args.indexOf(OFFICIAL_OPENCLAW_IMAGE);
    invariant(imageIndex > 0, 'GATEWAY_ARGUMENTS_INVALID', 'Pinned OpenClaw image was not found in Gateway arguments');
    args.splice(
      imageIndex,
      0,
      '--mount',
      `type=bind,source=${options.dwsFixturePath},target=${DINGTALK_DWS_FIXTURE_DESTINATION},readonly`,
    );
    const result = await this.run(args, { timeoutMs: 30_000, forwardGatewayToken: true });
    return result.stdout.trim();
  }
}

export function dingTalkResourceNames(runId) {
  invariant(typeof runId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(runId), 'RUN_ID_INVALID', 'Run id is invalid');
  const base = `junqi-dingtalk-smoke-${runId}`.toLowerCase();
  return {
    volumeName: `${base}-home`,
    setupNetworkName: `${base}-setup`,
    runtimeNetworkName: `${base}-runtime`,
    gatewayContainerName: `${base}-gateway`,
  };
}

export function dingTalkBootstrapContainerName(runId, step) {
  return `junqi-dingtalk-smoke-${runId}-${step}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
}

export function dingTalkBootstrapPlan(metadata, gatewayPort, options = {}) {
  const agents = [{
    id: 'main',
    default: true,
    name: 'JunQi DingTalk smoke agent',
    workspace: `${CONTAINER_HOME}/workspaces/main`,
  }];
  return [
    { id: 'gateway-mode', args: ['config', 'set', 'gateway.mode', '"local"', '--strict-json'] },
    { id: 'gateway-bind', args: ['config', 'set', 'gateway.bind', '"loopback"', '--strict-json'] },
    { id: 'gateway-port', args: ['config', 'set', 'gateway.port', String(gatewayPort), '--strict-json'] },
    { id: 'workspace', args: ['config', 'set', 'agents.defaults.workspace', JSON.stringify(`${CONTAINER_HOME}/workspaces/default`), '--strict-json'] },
    { id: 'skip-bootstrap', args: ['config', 'set', 'agents.defaults.skipBootstrap', 'true', '--strict-json'] },
    { id: 'disable-heartbeat', args: ['config', 'set', 'agents.defaults.heartbeat', JSON.stringify({ every: '0m' }), '--strict-json'] },
    { id: 'agents', args: ['config', 'set', 'agents.list', JSON.stringify(agents), '--strict-json', '--replace'] },
    {
      id: 'install',
      args: ['plugins', 'install', '--force', '--pin', `npm-pack:${DINGTALK_ARCHIVE_DESTINATION}`],
      archive: true,
      keepContainer: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    },
    {
      id: 'plugin-allowlist',
      args: ['config', 'set', 'plugins.allow', JSON.stringify([metadata.pluginId]), '--strict-json', '--replace'],
    },
    { id: 'enable', args: ['plugins', 'enable', metadata.pluginId] },
    {
      id: 'plugin-config',
      args: [
        'config',
        'set',
        `plugins.entries.${metadata.pluginId}.config`,
        JSON.stringify({
          allowedAgentIds: ['main'],
          ...(options.dwsPath ? { dwsPath: options.dwsPath } : {}),
        }),
        '--strict-json',
      ],
    },
    { id: 'validate-config', args: ['config', 'validate', '--json'] },
    { id: 'inspect-plugin', args: ['plugins', 'inspect', metadata.pluginId, '--json'] },
  ];
}

async function callSnapshotWithRetry(docker, containerName, gatewayPort) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return assertScopedReadSuccess(await docker.gatewayCallWithScopes(
        containerName,
        gatewayPort,
        EVENT_SNAPSHOT_METHOD,
        EVENT_SNAPSHOT_PARAMS,
        ['operator.read'],
      ));
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw lastError ?? new SmokeInvariantError('DINGTALK_SNAPSHOT_TIMEOUT', 'DingTalk event snapshot RPC did not become available');
}

export async function runDingTalkGatewaySmoke(options = {}) {
  const runId = options.runId ?? createSmokeRunId();
  const fixturePluginChain = options.fixturePluginChain === true;
  let dwsFixturePath;
  if (fixturePluginChain) {
    const candidate = options.dwsFixturePath ?? FIXTURE_DWS_SOURCE_PATH;
    await assertRegularFile(candidate, 'DWS fixture');
    dwsFixturePath = await realpath(candidate);
    invariant(path.isAbsolute(dwsFixturePath), 'DWS_FIXTURE_PATH_INVALID', 'Resolved DWS fixture path must be absolute');
    invariant(!dwsFixturePath.includes(','), 'DWS_FIXTURE_PATH_INVALID', 'Resolved DWS fixture path cannot contain a comma');
  }
  const names = dingTalkResourceNames(runId);
  const evidenceRoot = options.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT;
  const token = options.tokenFactory?.() ?? randomBytes(32).toString('hex');
  invariant(/^[a-f0-9]{64}$/.test(token), 'TOKEN_INVALID', 'Gateway token must be a 32-byte lowercase hexadecimal secret');
  const evidenceDirectory = path.join(evidenceRoot, runId);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await mkdir(evidenceDirectory, { recursive: false, mode: 0o700 });
  const evidencePath = path.join(evidenceDirectory, 'evidence.json');
  const gatewayLogPath = path.join(evidenceDirectory, 'gateway.log');
  const failureLogPath = path.join(evidenceDirectory, 'failure.log');
  const secrets = [token];
  const resources = {
    ...names,
    bootstrapContainerNames: new Set(),
  };
  const evidence = {
    formatVersion: EVIDENCE_FORMAT_VERSION,
    kind: fixturePluginChain
      ? 'JUNQI_DINGTALK_REAL_GATEWAY_FIXTURE_PLUGIN_CHAIN_SMOKE'
      : 'JUNQI_DINGTALK_REAL_GATEWAY_DISABLED_RUNTIME_SMOKE',
    scope: fixturePluginChain
      ? 'PINNED_GATEWAY_PLUGIN_DWS_FIXTURE_READ_WITHOUT_TENANT'
      : 'PINNED_BASELINE_RUNTIME_WITHOUT_DWS_OR_TENANT',
    runId,
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    image: {
      reference: OFFICIAL_OPENCLAW_IMAGE,
      version: OFFICIAL_OPENCLAW_VERSION,
      digest: OFFICIAL_OPENCLAW_IMAGE_DIGEST,
    },
    verified: {
      fixedArchiveInstalled: false,
      pluginConfigurationValidated: false,
      pluginInspected: false,
      gatewayRpcDispatched: false,
      disabledRuntimeProjection: false,
      operatorReadOnlyClientScope: false,
      runtimeGenerationRestartFence: false,
      ...(fixturePluginChain ? {
        isolatedSessionCreated: false,
        effectiveToolProjected: false,
        fixtureDwsSchemaValidated: false,
        gatewayPluginDwsRead: false,
      } : {}),
    },
    notVerified: {
      latestOpenClawMainRuntime: true,
      authenticatedProfileUnavailableGate: true,
      targetDingTalkTenant: true,
      dwsAuthentication: true,
      dwsSchemaContract: true,
      dwsBusinessReads: true,
      dwsBusinessWrites: true,
      dwsEventSubscription: true,
      gatewayEventDelivery: true,
      ...(fixturePluginChain ? { realDwsRuntime: true } : {}),
    },
    isolation: {
      userProfileAccessAllowed: false,
      devModeAllowed: false,
      setupNetworkEgress: true,
      runtimeNetworkInternal: true,
      defaultUserGatewayPort: DEFAULT_USER_GATEWAY_PORT,
      hostPortPublished: false,
      dwsPathConfigured: false,
      dwsProfileConfigured: false,
      dwsSubscriptionsConfigured: false,
      remoteDwsStarted: false,
      ...(fixturePluginChain ? { deterministicFixtureMounted: false } : {}),
    },
    resources: {
      volume: names.volumeName,
      setupNetwork: names.setupNetworkName,
      runtimeNetwork: names.runtimeNetworkName,
      gatewayContainer: names.gatewayContainerName,
    },
    steps: [],
    cleanup: { actions: [], errors: [] },
  };
  let docker = options.dockerRuntime;
  let primaryError = null;
  let gatewayLogs = '';
  let persistedEvidence = evidence;
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
    const bundle = options.bundle ?? await step('validate-bundle', () => loadAndValidateDingTalkBundle());
    if (options.bundle) evidence.steps.push({ id: 'validate-bundle', status: 'PASSED', durationMs: 0, injected: true });
    evidence.bundle = {
      pluginId: bundle.metadata.pluginId,
      packageName: bundle.metadata.packageName,
      pluginVersion: bundle.metadata.pluginVersion,
      toolCount: bundle.metadata.toolCount,
      sha256: bundle.metadata.sha256,
      archiveSize: bundle.archiveSize,
    };
    docker ??= new DingTalkDockerRuntime({
      token,
      runId,
      dockerBinary: options.dockerBinary,
      runner: options.runner,
    });
    evidence.docker = await step('docker-preflight', () => docker.preflight());
    evidence.image.inspection = await step('pull-pinned-image', () => docker.pullImage());
    await step('create-volume', () => docker.createVolume(names.volumeName));
    await step('create-setup-network', () => docker.createNetwork(names.setupNetworkName, false));
    evidence.isolation.setupNetwork = assertNetworkInspection(
      await step('inspect-setup-network', () => docker.networkInspection(names.setupNetworkName)),
      { name: names.setupNetworkName, internal: false, runId },
    );
    const gatewayPort = options.gatewayPortFactory?.() ?? allocateRandomGatewayPort();
    invariant(gatewayPort !== DEFAULT_USER_GATEWAY_PORT, 'GATEWAY_PORT_INVALID', 'Gateway must not use the user default port');
    evidence.isolation.isolatedGatewayPort = gatewayPort;

    for (const plannedStep of dingTalkBootstrapPlan(bundle.metadata, gatewayPort, {
      ...(fixturePluginChain ? { dwsPath: DINGTALK_DWS_FIXTURE_DESTINATION } : {}),
    })) {
      const containerName = dingTalkBootstrapContainerName(runId, plannedStep.id);
      resources.bootstrapContainerNames.add(containerName);
      const result = await step(`bootstrap-${plannedStep.id}`, () => docker.runBootstrap({
        containerName,
        networkName: names.setupNetworkName,
        volumeName: names.volumeName,
        archivePath: plannedStep.archive ? bundle.archivePath : undefined,
        archiveDestination: DINGTALK_ARCHIVE_DESTINATION,
        autoRemove: plannedStep.keepContainer !== true,
        openclawArgs: plannedStep.args,
        timeoutMs: plannedStep.timeoutMs,
      }));
      if (plannedStep.id === 'install') {
        evidence.isolation.installerMounts = assertInstallMountAllowlist(
          await step('inspect-installer-mounts', () => docker.containerMounts(containerName)),
          names.volumeName,
          bundle.archivePath,
          DINGTALK_ARCHIVE_DESTINATION,
        );
        evidence.isolation.installerSecurity = assertContainerSecurity(
          await step('inspect-installer-security', () => docker.containerSecurity(containerName)),
          names.setupNetworkName,
        );
        await step('remove-installer-container', () => docker.removeOwnedContainer(containerName));
        resources.bootstrapContainerNames.delete(containerName);
        evidence.verified.fixedArchiveInstalled = true;
      }
      if (plannedStep.id === 'validate-config') {
        evidence.configValidation = parseJsonOutput(result.stdout, 'openclaw config validate');
        invariant(evidence.configValidation?.valid === true, 'CONFIG_VALIDATION_FAILED', 'OpenClaw config validate did not report valid=true');
        evidence.verified.pluginConfigurationValidated = true;
      }
      if (plannedStep.id === 'inspect-plugin') {
        evidence.pluginInspection = parseJsonOutput(result.stdout, 'openclaw plugins inspect');
        invariant(evidence.pluginInspection && typeof evidence.pluginInspection === 'object', 'PLUGIN_INSPECTION_FAILED', 'OpenClaw plugin inspection did not return an object');
        evidence.verified.pluginInspected = true;
      }
      if (plannedStep.id === 'plugin-config' && fixturePluginChain) {
        evidence.isolation.dwsPathConfigured = true;
      }
    }

    await step('remove-setup-network', () => docker.removeOwnedNetwork(names.setupNetworkName));
    resources.setupNetworkName = null;
    await step('create-runtime-network', () => docker.createNetwork(names.runtimeNetworkName, true));
    evidence.isolation.runtimeNetwork = assertNetworkInspection(
      await step('inspect-runtime-network', () => docker.networkInspection(names.runtimeNetworkName)),
      { name: names.runtimeNetworkName, internal: true, runId },
    );
    await step('start-gateway', () => docker.startGateway({
      containerName: names.gatewayContainerName,
      networkName: names.runtimeNetworkName,
      volumeName: names.volumeName,
      gatewayPort,
      ...(dwsFixturePath ? { dwsFixturePath } : {}),
    }));
    evidence.readiness = {
      initial: await step('wait-initial-readiness', () => (options.readinessProbe ?? waitForGatewayReady)(docker, names.gatewayContainerName)),
    };
    const runtimeMounts = await step('inspect-runtime-mounts', () => docker.containerMounts(names.gatewayContainerName));
    evidence.isolation.runtimeMounts = fixturePluginChain
      ? assertDwsFixtureRuntimeMountAllowlist(runtimeMounts, names.volumeName, dwsFixturePath)
      : assertRuntimeMountAllowlist(runtimeMounts, names.volumeName);
    if (fixturePluginChain) evidence.isolation.deterministicFixtureMounted = true;
    evidence.isolation.runtimeSecurity = assertContainerSecurity(
      await step('inspect-runtime-security', () => docker.containerSecurity(names.gatewayContainerName)),
      names.runtimeNetworkName,
      { gatewayPort, token },
    );
    const runtimeProcessList = await step('inspect-runtime-process-arguments', () => docker.processList(names.gatewayContainerName));
    evidence.isolation.runtimeProcessArguments = assertProcessArgumentsSecure(runtimeProcessList, token);
    evidence.isolation.dwsProcesses = assertNoDwsProcess(runtimeProcessList);
    const reportedVersion = await step('verify-openclaw-version', () => docker.openclawVersion(names.gatewayContainerName));
    invariant(reportedVersion.includes(`OpenClaw ${OFFICIAL_OPENCLAW_VERSION}`), 'RUNTIME_VERSION_MISMATCH', `Container did not report OpenClaw ${OFFICIAL_OPENCLAW_VERSION}`);
    evidence.image.reportedVersion = reportedVersion;
    const firstSnapshot = assertDisabledDingTalkSnapshot(
      await step('dingtalk-snapshot-before-restart', () => (options.snapshotProbe ?? callSnapshotWithRetry)(docker, names.gatewayContainerName, gatewayPort)),
    );
    evidence.verified.gatewayRpcDispatched = true;
    evidence.verified.disabledRuntimeProjection = true;
    evidence.scopeAuthorization = {
      operatorRead: { authorized: true, requiredScopes: ['operator.read'] },
      operatorWriteOnly: assertWriteOnlyScopeDenied(await step(
        'dingtalk-snapshot-reject-write-only-scope',
        () => docker.gatewayCallWithScopes(
          names.gatewayContainerName,
          gatewayPort,
          EVENT_SNAPSHOT_METHOD,
          EVENT_SNAPSHOT_PARAMS,
          ['operator.write'],
        ),
      )),
    };
    evidence.verified.operatorReadOnlyClientScope = true;
    evidence.snapshot = {
      beforeRestart: firstSnapshot,
    };
    if (fixturePluginChain) {
      const requestedSessionKey = `agent:main:dingtalk-chain-${runId}`;
      const sessionResponse = await step(
        'create-isolated-tool-session',
        () => docker.gatewayCallWithScopes(
          names.gatewayContainerName,
          gatewayPort,
          'sessions.create',
          {
            key: requestedSessionKey,
            agentId: 'main',
            label: `DingTalk chain ${runId}`,
            idempotencyKey: `dingtalk-chain-${runId}`,
          },
          ['operator.write'],
        ),
      );
      invariant(sessionResponse?.ok === true, 'DINGTALK_SESSION_CREATE_FAILED', 'Isolated DingTalk tool session creation failed');
      invariant(sessionResponse.result?.ok === true, 'DINGTALK_SESSION_CREATE_FAILED', 'Isolated DingTalk tool session did not report success');
      invariant(sessionResponse.result.key === requestedSessionKey, 'DINGTALK_SESSION_CREATE_INVALID', 'Isolated DingTalk tool session returned the wrong key');
      invariant(typeof sessionResponse.result.sessionId === 'string' && sessionResponse.result.sessionId.length > 0, 'DINGTALK_SESSION_CREATE_INVALID', 'Isolated DingTalk tool session returned no session id');
      invariant(sessionResponse.result.runStarted === false, 'DINGTALK_SESSION_CREATE_INVALID', 'Isolated DingTalk tool session unexpectedly started an Agent run');
      evidence.verified.isolatedSessionCreated = true;

      const effectiveResponse = await step(
        'project-effective-dingtalk-tool',
        () => docker.gatewayCallWithScopes(
          names.gatewayContainerName,
          gatewayPort,
          'tools.effective',
          { sessionKey: requestedSessionKey, agentId: 'main' },
          ['operator.read'],
        ),
      );
      const effectiveTool = assertDingTalkEffectiveReadTool(assertScopedReadSuccess(effectiveResponse));
      evidence.verified.effectiveToolProjected = true;

      const invocationResponse = await step(
        'invoke-dingtalk-current-user-through-gateway',
        () => docker.gatewayCallWithScopes(
          names.gatewayContainerName,
          gatewayPort,
          'tools.invoke',
          {
            name: FIXTURE_TOOL_NAME,
            args: { profile: FIXTURE_PROFILE, arguments: {} },
            sessionKey: requestedSessionKey,
            agentId: 'main',
            idempotencyKey: `dingtalk-read-${runId}`,
          },
          ['operator.write'],
        ),
      );
      invariant(invocationResponse?.ok === true, 'DINGTALK_TOOL_INVOKE_FAILED', 'Gateway transport rejected DingTalk tools.invoke');
      const invocation = assertDingTalkFixtureReadInvocation(invocationResponse.result);
      evidence.fixtureChain = {
        toolName: effectiveTool.toolName,
        pluginId: effectiveTool.pluginId,
        source: invocation.source,
        schemaDigest: invocation.schemaDigest,
        businessPayloadRetained: false,
        profileRetained: false,
      };
      evidence.verified.fixtureDwsSchemaValidated = true;
      evidence.verified.gatewayPluginDwsRead = true;
      evidence.isolation.dwsProcessesAfterInvocation = assertNoDwsProcess(
        await step('inspect-processes-after-dws-invocation', () => docker.processList(names.gatewayContainerName)),
      );
    }
    await step('restart-gateway', () => docker.restart(names.gatewayContainerName));
    evidence.readiness.afterRestart = await step('wait-restart-readiness', () => (options.readinessProbe ?? waitForGatewayReady)(docker, names.gatewayContainerName));
    const secondSnapshot = assertDisabledDingTalkSnapshot(
      await step('dingtalk-snapshot-after-restart', () => (options.snapshotProbe ?? callSnapshotWithRetry)(docker, names.gatewayContainerName, gatewayPort)),
      { previousGeneration: firstSnapshot.runtimeGeneration },
    );
    evidence.snapshot.afterRestart = secondSnapshot;
    evidence.verified.runtimeGenerationRestartFence = true;
    evidence.status = 'PASSED';
  } catch (error) {
    primaryError = error;
    evidence.status = 'FAILED';
    evidence.failure = errorForEvidence(error, secrets);
  } finally {
    if (docker) {
      try {
        gatewayLogs = redactSensitive(await docker.logs(names.gatewayContainerName), secrets);
      } catch (error) {
        if (!primaryError) primaryError = error;
        evidence.logCaptureFailure = errorForEvidence(error, secrets);
        evidence.status = 'FAILED';
      }
      const cleanup = await cleanupResources(docker, resources);
      evidence.cleanup.actions = cleanup.actions;
      evidence.cleanup.errors = cleanup.errors.map(({ kind, name, error }) => ({
        kind,
        name,
        error: errorForEvidence(error, secrets),
      }));
      if (cleanup.errors.length > 0 && !primaryError) {
        primaryError = new SmokeInvariantError('RESOURCE_CLEANUP_FAILED', 'One or more Docker resources could not be cleaned');
        evidence.status = 'FAILED';
        evidence.failure = errorForEvidence(primaryError, secrets);
      }
    }
    evidence.finishedAt = new Date().toISOString();
    if (gatewayLogs) await writeFile(gatewayLogPath, `${gatewayLogs.trimEnd()}\n`, { mode: 0o600 });
    persistedEvidence = JSON.parse(redactSensitive(JSON.stringify(evidence), secrets));
    if (persistedEvidence.failure) {
      await writeFile(failureLogPath, `${JSON.stringify(persistedEvidence.failure, null, 2)}\n`, { mode: 0o600 });
    }
    await writeJsonAtomic(evidencePath, persistedEvidence);
  }
  if (primaryError) {
    throw new StructuralSmokeFailure(
      `${redactSensitive(primaryError.message, secrets)}; evidence: ${evidencePath}`,
      evidencePath,
    );
  }
  return { evidence: persistedEvidence, evidencePath, gatewayLogPath };
}

function usage() {
  return [
    'Usage: node scripts/verify-dingtalk-real-gateway.mjs [options]',
    '',
    'Options:',
    '  --evidence-root <path>  Parent directory for per-run evidence',
    '  --docker-binary <path>  Docker CLI binary (default: docker)',
    '  --fixture-plugin-chain   Exercise Gateway to plugin to deterministic DWS read chain',
    '  --help                  Show this help',
    '',
    'The default smoke installs the fixed DingTalk archive without DWS credentials or event subscriptions.',
    'Fixture chain mode proves the isolated protocol and process chain, not a real DWS runtime or tenant.',
  ].join('\n');
}

export function parseDingTalkSmokeCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (argument === '--fixture-plugin-chain') {
      options.fixturePluginChain = true;
      continue;
    }
    if (argument === '--evidence-root' || argument === '--docker-binary') {
      const value = argv[index + 1];
      invariant(value && !value.startsWith('--'), 'CLI_ARGUMENT_INVALID', `${argument} requires a value`);
      if (argument === '--evidence-root') options.evidenceRoot = path.resolve(value);
      else options.dockerBinary = value;
      index += 1;
      continue;
    }
    throw new SmokeInvariantError('CLI_ARGUMENT_INVALID', `Unknown argument: ${argument}`);
  }
  return options;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === SCRIPT_PATH) {
  try {
    const options = parseDingTalkSmokeCliArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      const result = await runDingTalkGatewaySmoke(options);
      console.log(JSON.stringify({
        status: result.evidence.status,
        scope: result.evidence.scope,
        runId: result.evidence.runId,
        evidencePath: result.evidencePath,
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      status: 'FAILED',
      code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
      ...(error?.evidencePath ? { evidencePath: error.evidencePath } : {}),
    }));
    process.exitCode = 1;
  }
}
