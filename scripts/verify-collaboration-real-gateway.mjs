#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);

export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const OFFICIAL_OPENCLAW_VERSION = '2026.7.1';
export const OFFICIAL_OPENCLAW_IMAGE_DIGEST =
  'sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c';
export const OFFICIAL_OPENCLAW_IMAGE =
  `ghcr.io/openclaw/openclaw:${OFFICIAL_OPENCLAW_VERSION}@${OFFICIAL_OPENCLAW_IMAGE_DIGEST}`;
export const DEFAULT_USER_GATEWAY_PORT = 18_789;
export const COLLABORATION_ARCHIVE_DESTINATION = '/run/junqi-input/junqi-collab.tgz';
export const DETERMINISTIC_PROVIDER_DESTINATION = '/run/junqi-provider/provider.mjs';
export const CONTAINER_HOME = '/home/node';
export const CONTAINER_STATE_DIRECTORY = `${CONTAINER_HOME}/.openclaw`;
export const EVIDENCE_FORMAT_VERSION = 1;

const RESOURCE_METADATA_PATH = path.join(
  REPOSITORY_ROOT,
  'src-tauri',
  'resources',
  'collaboration',
  'metadata.json',
);
const GENERATED_METADATA_PATH = path.join(
  REPOSITORY_ROOT,
  'src',
  'generated',
  'collaborationPluginBundle.generated.json',
);
const RESOURCE_ARCHIVE_PATH = path.join(
  REPOSITORY_ROOT,
  'src-tauri',
  'resources',
  'collaboration',
  'junqi-collab.tgz',
);
const DEFAULT_EVIDENCE_ROOT = path.join(
  REPOSITORY_ROOT,
  '.artifacts',
  'collaboration-real-gateway',
);

export const DOCKER_OWNER_LABEL = 'com.junqi.collaboration-smoke.run-id';
export const DOCKER_KIND_LABEL = 'com.junqi.collaboration-smoke.kind';
const PROCESS_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const IMAGE_PULL_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 90_000;
const GATEWAY_RPC_TIMEOUT_MS = 45_000;

const REQUIRED_FEATURES = [
  'SQLITE_AUTHORITY',
  'COMMAND_OUTBOX',
  'TASK_RECONCILE',
  'EXACT_TRANSCRIPT_DELIVERY',
  'EXACT_TRANSCRIPT_IDENTITY',
  'PLUGIN_SUBAGENT_TASK_LOOKUP',
  'PLUGIN_SUBAGENT_TASK_CANCEL',
  'EVENT_CURSOR',
  'SESSION_DELETE_CAS',
  'WRITE_INSTANCE_FENCE',
];

const ISOLATED_ENVIRONMENT = Object.freeze({
  HOME: CONTAINER_HOME,
  OPENCLAW_HOME: CONTAINER_HOME,
  OPENCLAW_STATE_DIR: CONTAINER_STATE_DIRECTORY,
  OPENCLAW_CONFIG_PATH: `${CONTAINER_STATE_DIRECTORY}/openclaw.json`,
  OPENCLAW_WORKSPACE_DIR: `${CONTAINER_HOME}/workspaces/default`,
  XDG_CONFIG_HOME: `${CONTAINER_HOME}/.config`,
  XDG_CACHE_HOME: `${CONTAINER_HOME}/.cache`,
  XDG_DATA_HOME: `${CONTAINER_HOME}/.local/share`,
  XDG_STATE_HOME: `${CONTAINER_HOME}/.local/state`,
  XDG_RUNTIME_DIR: '/tmp/xdg-runtime',
  TMPDIR: '/tmp',
  TMP: '/tmp',
  TEMP: '/tmp',
  NPM_CONFIG_CACHE: `${CONTAINER_HOME}/.npm`,
  NPM_CONFIG_AUDIT: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  OPENCLAW_DISABLE_BONJOUR: '1',
  OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
  NO_COLOR: '1',
});

export class SmokeInvariantError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SmokeInvariantError';
    this.code = code;
    this.details = details;
  }
}

export class ProcessExecutionError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'ProcessExecutionError';
    this.code = result.timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED';
    this.result = result;
  }
}

export class StructuralSmokeFailure extends Error {
  constructor(message, evidencePath) {
    super(message);
    this.name = 'StructuralSmokeFailure';
    this.code = 'STRUCTURAL_SMOKE_FAILED';
    this.evidencePath = evidencePath;
  }
}

function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new SmokeInvariantError(code, message, details);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await writeFile(temporaryPath, safeJson(value), { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function assertMetadataShape(metadata) {
  invariant(metadata?.formatVersion === 1, 'BUNDLE_METADATA_INVALID', 'Unexpected bundle metadata format');
  invariant(metadata.pluginId === 'junqi-collab', 'BUNDLE_METADATA_INVALID', 'Unexpected plugin id');
  invariant(
    metadata.packageName === '@junqi/openclaw-collaboration',
    'BUNDLE_METADATA_INVALID',
    'Unexpected collaboration package name',
  );
  invariant(
    typeof metadata.pluginVersion === 'string' && /^\d+\.\d+\.\d+$/.test(metadata.pluginVersion),
    'BUNDLE_METADATA_INVALID',
    'Invalid plugin version',
  );
  invariant(
    Number.isSafeInteger(metadata.schemaVersion) && metadata.schemaVersion > 0,
    'BUNDLE_METADATA_INVALID',
    'Invalid schema version',
  );
  invariant(
    typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.sha256),
    'BUNDLE_METADATA_INVALID',
    'Invalid archive SHA-256',
  );
  invariant(metadata.archiveFile === 'junqi-collab.tgz', 'BUNDLE_METADATA_INVALID', 'Unexpected archive file');
  invariant(
    metadata.resourcePath === 'collaboration/junqi-collab.tgz',
    'BUNDLE_METADATA_INVALID',
    'Unexpected archive resource path',
  );
}

function assertRunId(runId) {
  invariant(
    typeof runId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(runId),
    'RUN_ID_INVALID',
    'Run id must contain only lowercase letters, numbers, and hyphens',
  );
}

function assertGatewayToken(token) {
  invariant(
    typeof token === 'string' && /^[a-f0-9]{64}$/.test(token),
    'TOKEN_INVALID',
    'Gateway token must be a 32-byte lowercase hexadecimal secret',
  );
}

async function assertRegularFile(filePath, field) {
  const fileStat = await stat(filePath);
  invariant(fileStat.isFile(), 'BUNDLE_FILE_INVALID', `${field} is not a regular file`, { filePath });
}

export async function loadAndValidateBundle(options = {}) {
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
  invariant(
    resourceMetadataBytes.equals(generatedMetadataBytes),
    'BUNDLE_METADATA_DIVERGED',
    'Resource and generated collaboration metadata are not byte-identical',
  );

  let metadata;
  try {
    metadata = JSON.parse(resourceMetadataBytes.toString('utf8'));
  } catch (error) {
    throw new SmokeInvariantError('BUNDLE_METADATA_INVALID', 'Bundle metadata is not valid JSON', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  assertMetadataShape(metadata);

  const actualHash = sha256(archiveBytes);
  invariant(
    actualHash === metadata.sha256,
    'BUNDLE_HASH_MISMATCH',
    'Bundled collaboration archive does not match metadata',
    { expected: metadata.sha256, actual: actualHash },
  );

  const packedArchivePath = options.packedArchivePath ?? path.join(
    REPOSITORY_ROOT,
    'packages',
    'junqi-collab',
    'dist',
    `junqi-openclaw-collaboration-${metadata.pluginVersion}.tgz`,
  );
  await assertRegularFile(packedArchivePath, 'packed archive');
  const packedArchiveBytes = await readFile(packedArchivePath);
  invariant(
    packedArchiveBytes.equals(archiveBytes),
    'BUNDLE_ARCHIVE_DIVERGED',
    'Packed and Tauri resource collaboration archives are not byte-identical',
  );

  const resolvedArchivePath = await realpath(resourceArchivePath);
  if (options.repositoryRoot ?? REPOSITORY_ROOT) {
    const root = await realpath(options.repositoryRoot ?? REPOSITORY_ROOT);
    const relativeArchive = path.relative(root, resolvedArchivePath);
    invariant(
      relativeArchive !== '..' && !relativeArchive.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeArchive),
      'BUNDLE_PATH_INVALID',
      'Collaboration archive resolves outside the repository',
    );
  }

  return {
    metadata,
    archivePath: resolvedArchivePath,
    archiveSize: archiveBytes.byteLength,
    metadataPath: resourceMetadataPath,
  };
}

export function redactSensitive(value, secrets = []) {
  let output = String(value ?? '');
  const concreteSecrets = secrets
    .filter((secret) => typeof secret === 'string' && secret.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of concreteSecrets) output = output.split(secret).join('[REDACTED]');
  output = output
    .replace(/(OPENCLAW_GATEWAY_TOKEN\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/("[a-z0-9_.-]*(?:token|secret|password|api[_-]?key)[a-z0-9_.-]*"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/((?:[a-z0-9_.-]*(?:token|secret|password|api[_-]?key)[a-z0-9_.-]*)=)[^\s&]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]');
  return output;
}

function redactedClone(value, secrets) {
  return JSON.parse(redactSensitive(JSON.stringify(value), secrets));
}

export function errorForEvidence(error, secrets) {
  const result = error instanceof ProcessExecutionError ? error.result : null;
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
    message: redactSensitive(error instanceof Error ? error.message : String(error), secrets),
    ...(error?.details ? {
      details: JSON.parse(redactSensitive(JSON.stringify(error.details), secrets)),
    } : {}),
    ...(result ? {
      command: result.command,
      args: result.args,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      stdout: redactSensitive(result.stdout, secrets),
      stderr: redactSensitive(result.stderr, secrets),
    } : {}),
  };
}

export class ProcessRunner {
  async run(command, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? PROCESS_OUTPUT_LIMIT_BYTES;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let outputExceeded = false;
      let spawnError = null;

      const append = (target, chunk, currentBytes, streamName) => {
        const nextBytes = currentBytes + chunk.length;
        if (nextBytes > maxOutputBytes) {
          outputExceeded = true;
          child.kill('SIGKILL');
          return currentBytes;
        }
        target.push(chunk);
        return nextBytes;
      };
      child.stdout.on('data', (chunk) => {
        stdoutBytes = append(stdout, chunk, stdoutBytes, 'stdout');
      });
      child.stderr.on('data', (chunk) => {
        stderrBytes = append(stderr, chunk, stderrBytes, 'stderr');
      });
      child.once('error', (error) => {
        spawnError = error;
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      timer.unref?.();

      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        const result = {
          command,
          args: [...args],
          exitCode,
          signal,
          timedOut,
          durationMs: Date.now() - startedAt,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        };
        if (spawnError) {
          reject(new ProcessExecutionError(`Unable to start ${command}: ${spawnError.message}`, result));
          return;
        }
        if (outputExceeded) {
          reject(new ProcessExecutionError(`${command} exceeded the ${maxOutputBytes}-byte output limit`, result));
          return;
        }
        if (timedOut) {
          reject(new ProcessExecutionError(`${command} timed out after ${timeoutMs} ms`, result));
          return;
        }
        if (exitCode !== 0 && options.allowNonZero !== true) {
          reject(new ProcessExecutionError(`${command} exited with status ${exitCode}`, result));
          return;
        }
        resolve(result);
      });
    });
  }
}

function environmentArguments({ forwardGatewayToken = false } = {}) {
  const args = [];
  for (const [key, value] of Object.entries(ISOLATED_ENVIRONMENT)) args.push('--env', `${key}=${value}`);
  if (forwardGatewayToken) {
    // The value is forwarded from the Docker CLI process environment. It never
    // appears in argv, logs, evidence, or the persisted OpenClaw config.
    args.push('--env', 'OPENCLAW_GATEWAY_TOKEN');
  }
  return args;
}

function assertDockerName(value, field) {
  invariant(
    typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,127}$/.test(value),
    'RESOURCE_NAME_INVALID',
    `${field} is not a safe Docker resource name`,
  );
}

export function assertNoDevFlag(args) {
  invariant(
    !args.some((argument) => argument === '--dev' || argument.startsWith('--dev=')),
    'DEV_MODE_FORBIDDEN',
    'Real Gateway verification must never use --dev',
  );
}

export function buildIsolationDockerArgs({
  containerName,
  networkName,
  volumeName,
  runId,
  kind,
  autoRemove,
  archivePath,
  forwardGatewayToken = false,
}) {
  for (const [field, value] of Object.entries({ containerName, networkName, volumeName })) {
    assertDockerName(value, field);
  }
  invariant(!archivePath || !archivePath.includes(','), 'BUNDLE_PATH_INVALID', 'Archive path cannot contain a comma');

  const args = [
    'run',
    ...(autoRemove ? ['--rm'] : []),
    '--name', containerName,
    '--label', `${DOCKER_OWNER_LABEL}=${runId}`,
    '--label', `${DOCKER_KIND_LABEL}=${kind}`,
    '--network', networkName,
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--user', 'node',
    '--init',
    '--pids-limit', '512',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
    '--mount', `type=volume,source=${volumeName},target=${CONTAINER_HOME}`,
    ...environmentArguments({ forwardGatewayToken }),
  ];
  if (archivePath) {
    args.push(
      '--mount',
      `type=bind,source=${archivePath},target=${COLLABORATION_ARCHIVE_DESTINATION},readonly`,
    );
  }
  return args;
}

export function buildBootstrapRunArgs(options) {
  const args = [
    ...buildIsolationDockerArgs(options),
    OFFICIAL_OPENCLAW_IMAGE,
    'openclaw',
    '--no-color',
    ...options.openclawArgs,
  ];
  assertNoDevFlag(args);
  return args;
}

export function buildGatewayRunArgs(options) {
  invariant(
    Number.isSafeInteger(options.gatewayPort)
      && options.gatewayPort >= 49_152
      && options.gatewayPort <= 65_535
      && options.gatewayPort !== DEFAULT_USER_GATEWAY_PORT,
    'GATEWAY_PORT_INVALID',
    'Gateway must use a non-default dynamic port inside its isolated network namespace',
    { gatewayPort: options.gatewayPort },
  );
  const args = [
    ...buildIsolationDockerArgs({
      ...options,
      archivePath: undefined,
      autoRemove: false,
      forwardGatewayToken: true,
    }),
    '--stop-timeout', '30',
    '--detach',
    OFFICIAL_OPENCLAW_IMAGE,
    'openclaw',
    '--no-color',
    'gateway',
    'run',
    '--auth', 'token',
    '--bind', 'loopback',
    '--port', String(options.gatewayPort),
    '--ws-log', 'compact',
  ];
  assertNoDevFlag(args);
  return args;
}

export function buildProviderSidecarRunArgs(options) {
  for (const [field, value] of Object.entries({
    containerName: options.containerName,
    networkName: options.networkName,
    networkAlias: options.networkAlias,
  })) {
    assertDockerName(value, field);
  }
  invariant(
    typeof options.sourcePath === 'string' && path.isAbsolute(options.sourcePath),
    'SIDECAR_SOURCE_INVALID',
    'Provider sidecar source must be an absolute path',
  );
  invariant(!options.sourcePath.includes(','), 'SIDECAR_SOURCE_INVALID', 'Provider sidecar source cannot contain a comma');
  const args = [
    'run',
    '--name', options.containerName,
    '--label', `${DOCKER_OWNER_LABEL}=${options.runId}`,
    '--label', `${DOCKER_KIND_LABEL}=deterministic-provider`,
    '--network', options.networkName,
    '--network-alias', options.networkAlias,
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--user', 'node',
    '--init',
    '--pids-limit', '128',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=67108864',
    '--mount', `type=bind,source=${options.sourcePath},target=${DETERMINISTIC_PROVIDER_DESTINATION},readonly`,
    '--env', 'NO_COLOR=1',
    '--stop-timeout', '10',
    '--detach',
    OFFICIAL_OPENCLAW_IMAGE,
    'node', DETERMINISTIC_PROVIDER_DESTINATION,
  ];
  assertNoDevFlag(args);
  return args;
}

export function parseJsonOutput(output, context) {
  const trimmed = String(output ?? '').trim();
  invariant(trimmed.length > 0, 'INVALID_JSON_OUTPUT', `${context} returned empty output`);
  try {
    return JSON.parse(trimmed);
  } catch {
    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] !== '{' && trimmed[index] !== '[') continue;
      try {
        return JSON.parse(trimmed.slice(index));
      } catch {
        // Continue until a complete JSON suffix is found.
      }
    }
  }
  throw new SmokeInvariantError('INVALID_JSON_OUTPUT', `${context} did not return valid JSON`);
}

function capabilityPayload(value) {
  for (const candidate of [value, value?.result, value?.payload, value?.data]) {
    if (candidate && typeof candidate === 'object' && candidate.pluginId === 'junqi-collab') return candidate;
  }
  throw new SmokeInvariantError('CAPABILITIES_INVALID', 'Gateway response does not contain JunQi capabilities');
}

export function assertCapabilities(value, metadata) {
  const capabilities = capabilityPayload(value);
  invariant(capabilities.pluginVersion === metadata.pluginVersion, 'PLUGIN_VERSION_MISMATCH', 'Plugin version mismatch');
  invariant(capabilities.schemaVersion === metadata.schemaVersion, 'SCHEMA_VERSION_MISMATCH', 'Schema version mismatch');
  invariant(capabilities.runtimeVersion === OFFICIAL_OPENCLAW_VERSION, 'RUNTIME_VERSION_MISMATCH', 'Runtime version mismatch');
  invariant(capabilities.databaseIntegrity === 'ok', 'DATABASE_INTEGRITY_FAILED', 'Plugin database integrity failed');
  invariant(capabilities.configured === true, 'PLUGIN_NOT_CONFIGURED', 'Collaboration plugin is not configured');
  invariant(capabilities.durableState === true, 'DURABILITY_FAILED', 'Plugin did not report durable state');
  invariant(capabilities.durableRuntime?.supported === true, 'DURABILITY_FAILED', 'Durable runtime is unsupported');
  invariant(capabilities.durableRuntime?.required === true, 'DURABILITY_FAILED', 'Durable runtime is not required');
  invariant(capabilities.trustTier === 'portable-core', 'TRUST_TIER_INVALID', 'Unexpected plugin trust tier');
  invariant(capabilities.workboard?.supported === false, 'WORKBOARD_CONTRACT_INVALID', 'Workboard must remain unsupported');
  invariant(
    capabilities.featureEvidence?.kind === 'DECLARED_PLUGIN_CONTRACT',
    'FEATURE_EVIDENCE_INVALID',
    'Unexpected feature evidence kind',
  );
  invariant(
    capabilities.featureEvidence?.behaviorVerified === false,
    'FEATURE_EVIDENCE_INVALID',
    'Structural smoke must not claim behavioral verification',
  );
  invariant(
    capabilities.featureEvidence?.requiredBehaviorGate === 'ISOLATED_REAL_GATEWAY',
    'FEATURE_EVIDENCE_INVALID',
    'Unexpected behavior gate',
  );
  invariant(
    capabilities.featureEvidence?.structuralChecks?.pluginServiceStarted === true,
    'FEATURE_EVIDENCE_INVALID',
    'Plugin service did not report started',
  );
  invariant(
    capabilities.featureEvidence?.structuralChecks?.databaseIntegrity === 'ok',
    'FEATURE_EVIDENCE_INVALID',
    'Feature evidence database check failed',
  );
  invariant(
    capabilities.featureEvidence?.structuralChecks?.configured === true,
    'FEATURE_EVIDENCE_INVALID',
    'Feature evidence reports an unconfigured plugin',
  );
  invariant(capabilities.sessionCapabilities?.deleteExpectedSessionId === true, 'SESSION_CAPABILITY_INVALID', 'Delete CAS missing');
  invariant(capabilities.sessionCapabilities?.resetExpectedSessionId === false, 'SESSION_CAPABILITY_INVALID', 'Reset CAS must be false');
  for (const feature of REQUIRED_FEATURES) {
    invariant(capabilities.features?.includes(feature), 'FEATURE_MISSING', `Required feature is missing: ${feature}`);
  }
  invariant(
    typeof capabilities.collaborationInstanceId === 'string' && capabilities.collaborationInstanceId.length > 0,
    'INSTANCE_ID_INVALID',
    'Collaboration instance id is missing',
  );
  return capabilities;
}

export function assertCapabilitiesStable(first, second) {
  invariant(
    first.collaborationInstanceId === second.collaborationInstanceId,
    'INSTANCE_ID_CHANGED',
    'Collaboration instance id changed across Gateway restart',
  );
  invariant(first.pluginVersion === second.pluginVersion, 'PLUGIN_VERSION_CHANGED', 'Plugin version changed across restart');
  invariant(first.schemaVersion === second.schemaVersion, 'SCHEMA_VERSION_CHANGED', 'Schema version changed across restart');
}

function mountProjection(mount) {
  return {
    type: mount.Type,
    name: mount.Name ?? null,
    destination: mount.Destination,
    readWrite: mount.RW === true,
  };
}

export function assertRuntimeMountAllowlist(mounts, volumeName) {
  invariant(Array.isArray(mounts), 'MOUNT_INSPECTION_INVALID', 'Container mounts are not an array');
  invariant(mounts.length === 1, 'MOUNT_ALLOWLIST_FAILED', 'Gateway has unexpected mounts', {
    mounts: mounts.map(mountProjection),
  });
  const homeMount = mounts[0];
  invariant(homeMount.Type === 'volume', 'MOUNT_ALLOWLIST_FAILED', 'Gateway home must use a Docker volume');
  invariant(homeMount.Name === volumeName, 'MOUNT_ALLOWLIST_FAILED', 'Gateway uses the wrong home volume');
  invariant(homeMount.Destination === CONTAINER_HOME, 'MOUNT_ALLOWLIST_FAILED', 'Gateway home mount target is wrong');
  invariant(homeMount.RW === true, 'MOUNT_ALLOWLIST_FAILED', 'Gateway home volume must be writable');
  return mounts.map(mountProjection);
}

export function assertInstallMountAllowlist(mounts, volumeName, archivePath) {
  invariant(Array.isArray(mounts) && mounts.length === 2, 'MOUNT_ALLOWLIST_FAILED', 'Installer has unexpected mounts', {
    mounts: Array.isArray(mounts) ? mounts.map(mountProjection) : mounts,
  });
  const homeMount = mounts.find((mount) => mount.Destination === CONTAINER_HOME);
  const archiveMount = mounts.find((mount) => mount.Destination === COLLABORATION_ARCHIVE_DESTINATION);
  invariant(homeMount?.Type === 'volume' && homeMount.Name === volumeName && homeMount.RW === true, 'MOUNT_ALLOWLIST_FAILED', 'Installer home mount is invalid');
  invariant(archiveMount?.Type === 'bind' && archiveMount.RW === false, 'MOUNT_ALLOWLIST_FAILED', 'Installer archive mount is not read-only');
  const expectedSource = path.resolve(archivePath);
  const inspectedSource = path.resolve(archiveMount.Source);
  const dockerDesktopSources = [
    path.posix.normalize(`/host_mnt${expectedSource}`),
    path.posix.normalize(`/run/desktop/mnt/host${expectedSource}`),
  ];
  invariant(
    inspectedSource === expectedSource || dockerDesktopSources.includes(inspectedSource),
    'MOUNT_ALLOWLIST_FAILED',
    'Installer archive source is wrong',
  );
  return mounts.map(mountProjection);
}

export function assertContainerSecurity(
  inspection,
  expectedNetwork,
  { gatewayPort, token } = {},
) {
  invariant(inspection.readonlyRootfs === true, 'CONTAINER_SECURITY_FAILED', 'Container root filesystem is writable');
  invariant(inspection.capDrop?.some((value) => String(value).toUpperCase() === 'ALL'), 'CONTAINER_SECURITY_FAILED', 'Container does not drop all capabilities');
  invariant(
    inspection.securityOpt?.some((value) => String(value).startsWith('no-new-privileges')),
    'CONTAINER_SECURITY_FAILED',
    'Container does not enforce no-new-privileges',
  );
  invariant(inspection.networkMode === expectedNetwork, 'CONTAINER_SECURITY_FAILED', 'Container is attached to the wrong network');
  invariant(inspection.user === 'node', 'CONTAINER_SECURITY_FAILED', 'Container does not run as the node user');
  invariant(typeof inspection.tmpfs?.['/tmp'] === 'string', 'CONTAINER_SECURITY_FAILED', 'Container /tmp is not tmpfs-backed');
  for (const option of ['rw', 'nosuid', 'nodev']) {
    invariant(inspection.tmpfs['/tmp'].split(',').includes(option), 'CONTAINER_SECURITY_FAILED', `Container /tmp is missing ${option}`);
  }
  assertNoDevFlag(inspection.command ?? []);
  const command = inspection.command ?? [];
  invariant(!command.includes('--token'), 'CONTAINER_SECURITY_FAILED', 'Gateway token must not appear in process argv');
  if (token) {
    invariant(!command.some((argument) => String(argument).includes(token)), 'CONTAINER_SECURITY_FAILED', 'Gateway token leaked into process argv');
  }
  if (gatewayPort !== undefined) {
    invariant(
      inspection.portBindings == null || Object.keys(inspection.portBindings).length === 0,
      'PORT_BINDING_INVALID',
      'Internal Gateway container must not publish any host port',
    );
    const portIndex = command.indexOf('--port');
    invariant(portIndex >= 0 && Number(command[portIndex + 1]) === gatewayPort, 'GATEWAY_PORT_INVALID', 'Gateway process uses the wrong isolated port');
  }
  return {
    readonlyRootfs: true,
    capDrop: ['ALL'],
    noNewPrivileges: true,
    networkMode: inspection.networkMode,
    user: inspection.user,
    tmpfs: ['/tmp'],
    ...(gatewayPort !== undefined ? {
      isolatedGatewayPort: gatewayPort,
      hostPortPublished: false,
    } : {}),
  };
}

export function assertProcessArgumentsSecure(processList, token) {
  const output = String(processList ?? '');
  invariant(output.trim().length > 0, 'PROCESS_INSPECTION_INVALID', 'docker top returned no process rows');
  invariant(!output.includes(token), 'CONTAINER_SECURITY_FAILED', 'Gateway token leaked into live process argv');
  invariant(!/(?:^|\s)--token(?:\s|=|$)/m.test(output), 'CONTAINER_SECURITY_FAILED', 'Live Gateway process argv contains --token');
  return {
    processRows: Math.max(0, output.trim().split(/\r?\n/).length - 1),
    tokenInProcessArguments: false,
    tokenFlagInProcessArguments: false,
  };
}

export function assertNetworkInspection(inspection, { name, internal, runId }) {
  invariant(inspection.name === name, 'NETWORK_INSPECTION_INVALID', 'Docker network name mismatch');
  invariant(inspection.driver === 'bridge', 'NETWORK_INSPECTION_INVALID', 'Docker network must use the bridge driver');
  invariant(inspection.internal === internal, 'NETWORK_INSPECTION_INVALID', 'Docker network isolation mode mismatch');
  invariant(inspection.labels?.[DOCKER_OWNER_LABEL] === runId, 'RESOURCE_OWNERSHIP_INVALID', 'Docker network ownership label mismatch');
  return { name, driver: inspection.driver, internal };
}

const CONTAINER_SECURITY_TEMPLATE = [
  '{',
  '"readonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},',
  '"capDrop":{{json .HostConfig.CapDrop}},',
  '"securityOpt":{{json .HostConfig.SecurityOpt}},',
  '"networkMode":{{json .HostConfig.NetworkMode}},',
  '"tmpfs":{{json .HostConfig.Tmpfs}},',
  '"portBindings":{{json .HostConfig.PortBindings}},',
  '"command":{{json .Config.Cmd}},',
  '"user":{{json .Config.User}}',
  '}',
].join('');

const FIND_SQLITE_SCRIPT = `
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = ${JSON.stringify(CONTAINER_STATE_DIRECTORY)};
const matches = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) await walk(candidate);
    else if (info.isFile() && entry.name === 'collaboration.sqlite') matches.push(candidate);
  }
}
await walk(root);
console.log(JSON.stringify(matches.sort()));
`;

const INSPECT_SQLITE_SCRIPT = `
import { DatabaseSync } from 'node:sqlite';
const file = process.argv[1];
const database = new DatabaseSync(file, { readOnly: true });
try {
  database.exec('PRAGMA query_only = ON');
  const integrityRow = database.prepare('PRAGMA integrity_check').get();
  const integrity = integrityRow ? Object.values(integrityRow)[0] : null;
  const rows = database.prepare(
    "SELECT key, value FROM metadata WHERE key IN ('schema_version', 'collaboration_instance_id') ORDER BY key"
  ).all();
  const metadata = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
  const authorityTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collaboration_runs'"
  ).get();
  console.log(JSON.stringify({
    integrity,
    schemaVersion: Number(metadata.schema_version),
    collaborationInstanceId: metadata.collaboration_instance_id ?? null,
    authorityTablePresent: authorityTable?.name === 'collaboration_runs',
  }));
} finally {
  database.close();
}
`;

const SQLITE_EXEC_SCRIPT = `
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(process.argv[1]);
try {
  database.exec(process.argv[2]);
  console.log(JSON.stringify({ ok: true }));
} finally {
  database.close();
}
`;

const CONTAINER_JSON_REQUEST_SCRIPT = `
const [url, method, serializedBody] = process.argv.slice(1);
const response = await fetch(url, {
  method,
  headers: serializedBody ? { 'content-type': 'application/json' } : undefined,
  body: serializedBody || undefined,
  signal: AbortSignal.timeout(15000),
});
const text = await response.text();
if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, body: text.slice(0, 2048) }));
  process.exit(2);
}
console.log(text);
`;

export class DockerRuntime {
  constructor({ runner = new ProcessRunner(), token, runId, dockerBinary = 'docker' }) {
    this.runner = runner;
    this.runId = runId;
    this.dockerBinary = dockerBinary;
    this.baseEnvironment = {
      ...process.env,
      DOCKER_CLI_HINTS: 'false',
    };
    delete this.baseEnvironment.OPENCLAW_GATEWAY_TOKEN;
    this.gatewayEnvironment = {
      ...this.baseEnvironment,
      OPENCLAW_GATEWAY_TOKEN: token,
    };
  }

  run(args, options = {}) {
    return this.runner.run(this.dockerBinary, args, {
      env: options.forwardGatewayToken ? this.gatewayEnvironment : this.baseEnvironment,
      timeoutMs: options.timeoutMs,
      allowNonZero: options.allowNonZero,
    });
  }

  async preflight() {
    const result = await this.run([
      'version',
      '--format',
      '{"client":{{json .Client.Version}},"server":{{json .Server.Version}},"os":{{json .Server.Os}},"architecture":{{json .Server.Arch}}}',
    ]);
    return parseJsonOutput(result.stdout, 'docker version');
  }

  async pullImage() {
    await this.run(['pull', OFFICIAL_OPENCLAW_IMAGE], { timeoutMs: IMAGE_PULL_TIMEOUT_MS });
    const result = await this.run([
      'image',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"repoDigests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}',
      OFFICIAL_OPENCLAW_IMAGE,
    ]);
    const inspection = parseJsonOutput(result.stdout, 'docker image inspect');
    invariant(inspection.os === 'linux', 'IMAGE_PLATFORM_INVALID', 'OpenClaw image is not Linux');
    invariant(['amd64', 'arm64'].includes(inspection.architecture), 'IMAGE_PLATFORM_INVALID', 'Unsupported image architecture');
    return inspection;
  }

  async createVolume(name) {
    await this.run([
      'volume', 'create',
      '--label', `${DOCKER_OWNER_LABEL}=${this.runId}`,
      '--label', `${DOCKER_KIND_LABEL}=state`,
      name,
    ]);
    await this.assertOwned('volume', name);
  }

  async createNetwork(name, internal) {
    await this.run([
      'network', 'create',
      '--driver', 'bridge',
      ...(internal ? ['--internal'] : []),
      '--label', `${DOCKER_OWNER_LABEL}=${this.runId}`,
      '--label', `${DOCKER_KIND_LABEL}=${internal ? 'runtime-network' : 'setup-network'}`,
      name,
    ]);
    await this.assertOwned('network', name);
  }

  async networkInspection(name) {
    const result = await this.run([
      'network', 'inspect',
      '--format',
      '{"name":{{json .Name}},"internal":{{json .Internal}},"driver":{{json .Driver}},"labels":{{json .Labels}}}',
      name,
    ]);
    return parseJsonOutput(result.stdout, 'docker network inspect');
  }

  async runBootstrap(options) {
    const args = buildBootstrapRunArgs({
      ...options,
      runId: this.runId,
      kind: 'bootstrap',
    });
    return this.run(args, { timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS });
  }

  async startGateway(options) {
    const result = await this.run(buildGatewayRunArgs({
      ...options,
      runId: this.runId,
      kind: 'gateway',
    }), {
      timeoutMs: COMMAND_TIMEOUT_MS,
      forwardGatewayToken: true,
    });
    return result.stdout.trim();
  }

  async startProviderSidecar(options) {
    const result = await this.run(buildProviderSidecarRunArgs({
      ...options,
      runId: this.runId,
    }), { timeoutMs: COMMAND_TIMEOUT_MS });
    return result.stdout.trim();
  }

  async containerJsonRequest(name, url, options = {}) {
    invariant(/^http:\/\/[a-z0-9_.-]+(?::\d+)?\/[a-z0-9_./-]*$/i.test(url), 'REQUEST_URL_INVALID', 'Container request URL is not allowed');
    const method = options.method ?? 'GET';
    invariant(['GET', 'POST'].includes(method), 'REQUEST_METHOD_INVALID', 'Container request method is not allowed');
    const serializedBody = options.body === undefined ? '' : JSON.stringify(options.body);
    const result = await this.run([
      'exec', name,
      'node', '--input-type=module', '--eval', CONTAINER_JSON_REQUEST_SCRIPT,
      url, method, serializedBody,
    ], { timeoutMs: 25_000 });
    return parseJsonOutput(result.stdout, `container request ${method} ${url}`);
  }

  async containerMounts(name) {
    const result = await this.run(['inspect', '--format', '{{json .Mounts}}', name]);
    return parseJsonOutput(result.stdout, 'docker mount inspect');
  }

  async containerSecurity(name) {
    const result = await this.run(['inspect', '--format', CONTAINER_SECURITY_TEMPLATE, name]);
    return parseJsonOutput(result.stdout, 'docker security inspect');
  }

  async processList(name) {
    const result = await this.run(['top', name, '-eo', 'pid,args'], {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    return result.stdout;
  }

  async openclawVersion(name) {
    const result = await this.run(['exec', name, 'openclaw', '--version'], { timeoutMs: GATEWAY_RPC_TIMEOUT_MS });
    return result.stdout.trim();
  }

  async gatewayCall(name, method, params = {}) {
    const result = await this.run([
      'exec', name,
      'openclaw', '--no-color',
      'gateway', 'call', method,
      '--params', JSON.stringify(params),
      '--timeout', String(GATEWAY_RPC_TIMEOUT_MS),
      '--json',
    ], { timeoutMs: GATEWAY_RPC_TIMEOUT_MS + 10_000 });
    return parseJsonOutput(result.stdout, `gateway call ${method}`);
  }

  async gatewayHealth(name) {
    const result = await this.run([
      'exec', name,
      'openclaw', '--no-color',
      'gateway', 'health', '--json',
      '--timeout', '5000',
    ], { timeoutMs: 15_000 });
    return parseJsonOutput(result.stdout, 'gateway health');
  }

  async findCollaborationDatabases(name) {
    const result = await this.run([
      'exec', name,
      'node', '--input-type=module', '--eval', FIND_SQLITE_SCRIPT,
    ], { timeoutMs: GATEWAY_RPC_TIMEOUT_MS });
    return parseJsonOutput(result.stdout, 'collaboration SQLite discovery');
  }

  async inspectSqlite(name, sqlitePath) {
    const result = await this.run([
      'exec', name,
      'node', '--input-type=module', '--eval', INSPECT_SQLITE_SCRIPT, sqlitePath,
    ], { timeoutMs: GATEWAY_RPC_TIMEOUT_MS });
    return parseJsonOutput(result.stdout, 'collaboration SQLite inspection');
  }

  async executeSqlite(name, sqlitePath, sql) {
    invariant(
      typeof sqlitePath === 'string' && sqlitePath.startsWith(`${CONTAINER_STATE_DIRECTORY}/`),
      'SQLITE_PATH_INVALID',
      'SQLite database path is outside isolated OpenClaw state',
    );
    invariant(typeof sql === 'string' && sql.length > 0 && sql.length <= 32_768, 'SQLITE_STATEMENT_INVALID', 'SQLite statement is invalid');
    const result = await this.run([
      'exec', name,
      'node', '--input-type=module', '--eval', SQLITE_EXEC_SCRIPT,
      sqlitePath, sql,
    ], { timeoutMs: GATEWAY_RPC_TIMEOUT_MS });
    return parseJsonOutput(result.stdout, 'collaboration SQLite statement');
  }

  async restart(name) {
    // docker restart sends the configured stop signal first. The bounded
    // timeout gives the plugin service time to checkpoint and drain before
    // Docker escalates, while still preventing a wedged verification run.
    await this.run(['restart', '--timeout', '15', name], { timeoutMs: READY_TIMEOUT_MS });
  }

  async logs(name) {
    const result = await this.run(
      ['logs', '--timestamps', '--tail', '2000', name],
      { timeoutMs: COMMAND_TIMEOUT_MS, allowNonZero: true },
    );
    return `${result.stdout}${result.stderr}`;
  }

  async inspectOwner(kind, name) {
    const command = kind === 'container'
      ? ['inspect', '--format', `{{ index .Config.Labels ${JSON.stringify(DOCKER_OWNER_LABEL)} }}`, name]
      : [kind, 'inspect', '--format', `{{ index .Labels ${JSON.stringify(DOCKER_OWNER_LABEL)} }}`, name];
    const result = await this.run(command, { allowNonZero: true, timeoutMs: COMMAND_TIMEOUT_MS });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  }

  async assertOwned(kind, name) {
    const owner = await this.inspectOwner(kind, name);
    invariant(owner === this.runId, 'RESOURCE_OWNERSHIP_INVALID', `Refusing to use unowned Docker ${kind}: ${name}`);
  }

  async removeOwnedContainer(name) {
    const owner = await this.inspectOwner('container', name);
    if (owner === null) return { kind: 'container', name, removed: false, missing: true };
    invariant(owner === this.runId, 'RESOURCE_OWNERSHIP_INVALID', `Refusing to remove unowned Docker container: ${name}`);
    let stopped;
    try {
      stopped = await this.run(['stop', '--timeout', '15', name], {
        allowNonZero: true,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      // A wedged docker stop client must not prevent the ownership-fenced force
      // removal fallback from running during the outer finally block.
      stopped = {
        exitCode: null,
        stderr: error instanceof ProcessExecutionError
          ? error.result.stderr
          : error instanceof Error ? error.message : String(error),
      };
    }
    const removeCommand = stopped.exitCode === 0
      ? ['rm', '--volumes', name]
      : ['rm', '--force', '--volumes', name];
    const removed = await this.run(removeCommand, {
      allowNonZero: true,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    invariant(removed.exitCode === 0, 'RESOURCE_CLEANUP_FAILED', `Unable to remove Docker container: ${name}`, {
      stopStderr: stopped.stderr,
      removeStderr: removed.stderr,
    });
    return {
      kind: 'container',
      name,
      removed: true,
      missing: false,
      forced: stopped.exitCode !== 0,
    };
  }

  async removeOwnedNetwork(name) {
    return this.removeOwned('network', name, ['network', 'rm', name]);
  }

  async removeOwnedVolume(name) {
    return this.removeOwned('volume', name, ['volume', 'rm', name]);
  }

  async removeOwned(kind, name, command) {
    const owner = await this.inspectOwner(kind, name);
    if (owner === null) return { kind, name, removed: false, missing: true };
    invariant(owner === this.runId, 'RESOURCE_OWNERSHIP_INVALID', `Refusing to remove unowned Docker ${kind}: ${name}`);
    const result = await this.run(command, { allowNonZero: true, timeoutMs: COMMAND_TIMEOUT_MS });
    invariant(result.exitCode === 0, 'RESOURCE_CLEANUP_FAILED', `Unable to remove Docker ${kind}: ${name}`, {
      stderr: result.stderr,
    });
    return { kind, name, removed: true, missing: false };
  }
}

export function allocateRandomGatewayPort() {
  const candidate = 49_152 + randomBytes(2).readUInt16BE(0) % (65_535 - 49_152 + 1);
  invariant(candidate !== DEFAULT_USER_GATEWAY_PORT, 'GATEWAY_PORT_INVALID', 'Random Gateway port matched the user default');
  return candidate;
}

export async function waitForGatewayReady(docker, containerName, options = {}) {
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = 'Gateway did not respond';
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    try {
      const health = await docker.gatewayHealth(containerName);
      invariant(
        health?.ok === true,
        'GATEWAY_UNHEALTHY',
        'Gateway health response did not report ok=true',
        { health },
      );
      return { attempts, durationMs: Date.now() - startedAt, health };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new SmokeInvariantError('GATEWAY_READY_TIMEOUT', `Gateway readiness timed out: ${lastError}`, {
    attempts,
    timeoutMs,
  });
}

async function callCapabilitiesWithRetry(docker, containerName) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await docker.gatewayCall(containerName, 'junqi.collab.capabilities');
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw lastError ?? new SmokeInvariantError('CAPABILITIES_TIMEOUT', 'Capabilities RPC did not become available');
}

export function createSmokeRunId() {
  return `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(5).toString('hex')}`;
}

export function collaborationResourceNames(runId) {
  const base = `junqi-collab-smoke-${runId}`.toLowerCase();
  return {
    volumeName: `${base}-home`,
    setupNetworkName: `${base}-setup`,
    runtimeNetworkName: `${base}-runtime`,
    gatewayContainerName: `${base}-gateway`,
  };
}

export function collaborationBootstrapContainerName(runId, step) {
  return `junqi-collab-smoke-${runId}-${step}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
}

function bootstrapPlan(metadata, gatewayPort) {
  const agents = [
    {
      id: 'coordinator',
      default: true,
      name: 'JunQi smoke coordinator',
      workspace: `${CONTAINER_HOME}/workspaces/coordinator`,
      subagents: { allowAgents: ['coordinator', 'worker'] },
    },
    {
      id: 'worker',
      name: 'JunQi smoke worker',
      workspace: `${CONTAINER_HOME}/workspaces/worker`,
    },
  ];
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
      args: ['plugins', 'install', '--force', '--pin', `npm-pack:${COLLABORATION_ARCHIVE_DESTINATION}`],
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
        'config', 'set',
        `plugins.entries.${metadata.pluginId}.config`,
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

export async function cleanupResources(docker, resources) {
  const actions = [];
  const errors = [];
  const attempt = async (kind, name, operation) => {
    if (!name) return;
    try {
      actions.push(await operation(name));
    } catch (error) {
      errors.push({ kind, name, error });
    }
  };

  await attempt('container', resources.gatewayContainerName, (name) => docker.removeOwnedContainer(name));
  for (const name of [...(resources.sidecarContainerNames ?? [])].reverse()) {
    await attempt('container', name, (candidate) => docker.removeOwnedContainer(candidate));
  }
  for (const name of [...(resources.bootstrapContainerNames ?? [])].reverse()) {
    await attempt('container', name, (candidate) => docker.removeOwnedContainer(candidate));
  }
  await attempt('network', resources.setupNetworkName, (name) => docker.removeOwnedNetwork(name));
  await attempt('network', resources.runtimeNetworkName, (name) => docker.removeOwnedNetwork(name));
  await attempt('volume', resources.volumeName, (name) => docker.removeOwnedVolume(name));
  return { actions, errors };
}

function summarizeCapabilities(capabilities) {
  return {
    collaborationInstanceId: capabilities.collaborationInstanceId,
    pluginId: capabilities.pluginId,
    pluginVersion: capabilities.pluginVersion,
    schemaVersion: capabilities.schemaVersion,
    runtimeVersion: capabilities.runtimeVersion,
    databaseIntegrity: capabilities.databaseIntegrity,
    configured: capabilities.configured,
    durableState: capabilities.durableState,
    durableRuntime: capabilities.durableRuntime,
    trustTier: capabilities.trustTier,
    workboard: capabilities.workboard,
    sessionCapabilities: capabilities.sessionCapabilities,
    features: capabilities.features,
    featureEvidence: capabilities.featureEvidence,
    coordinatorAgentId: capabilities.coordinatorAgentId,
    allowedAgentIds: capabilities.allowedAgentIds,
  };
}

function assertSqliteInspection(inspection, capabilities, metadata) {
  invariant(inspection.integrity === 'ok', 'SQLITE_INTEGRITY_FAILED', 'Direct SQLite integrity check failed');
  invariant(inspection.schemaVersion === metadata.schemaVersion, 'SQLITE_SCHEMA_MISMATCH', 'Direct SQLite schema mismatch');
  invariant(inspection.authorityTablePresent === true, 'SQLITE_AUTHORITY_MISSING', 'collaboration_runs table is missing');
  invariant(
    inspection.collaborationInstanceId === capabilities.collaborationInstanceId,
    'SQLITE_INSTANCE_MISMATCH',
    'SQLite and capabilities instance ids differ',
  );
}

export async function runStructuralGatewaySmoke(options = {}) {
  const runId = options.runId ?? createSmokeRunId();
  assertRunId(runId);
  const names = collaborationResourceNames(runId);
  const evidenceRoot = options.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT;
  const token = options.tokenFactory?.() ?? randomBytes(32).toString('hex');
  assertGatewayToken(token);
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
    kind: 'JUNQI_COLLABORATION_REAL_GATEWAY_STRUCTURAL_SMOKE',
    scope: 'STRUCTURAL_ONLY',
    p0BehaviorVerified: false,
    runId,
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    image: {
      reference: OFFICIAL_OPENCLAW_IMAGE,
      version: OFFICIAL_OPENCLAW_VERSION,
      digest: OFFICIAL_OPENCLAW_IMAGE_DIGEST,
    },
    isolation: {
      userProfileAccessAllowed: false,
      devModeAllowed: false,
      setupNetworkEgress: true,
      runtimeNetworkInternal: true,
      isolatedPaths: { ...ISOLATED_ENVIRONMENT },
      defaultUserGatewayPort: DEFAULT_USER_GATEWAY_PORT,
      hostPortPublished: false,
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
    const bundle = options.bundle ?? await step('validate-bundle', () => loadAndValidateBundle());
    if (options.bundle) evidence.steps.push({ id: 'validate-bundle', status: 'PASSED', durationMs: 0, injected: true });
    evidence.bundle = {
      pluginId: bundle.metadata.pluginId,
      packageName: bundle.metadata.packageName,
      pluginVersion: bundle.metadata.pluginVersion,
      schemaVersion: bundle.metadata.schemaVersion,
      sha256: bundle.metadata.sha256,
      archiveSize: bundle.archiveSize,
    };

    docker ??= new DockerRuntime({
      token,
      runId,
      dockerBinary: options.dockerBinary,
      runner: options.runner,
    });
    evidence.docker = await step('docker-preflight', () => docker.preflight());
    evidence.image.inspection = await step('pull-pinned-image', () => docker.pullImage());

    await step('create-volume', () => docker.createVolume(names.volumeName));
    await step('create-setup-network', () => docker.createNetwork(names.setupNetworkName, false));
    const setupNetworkInspection = await step(
      'inspect-setup-network',
      () => docker.networkInspection(names.setupNetworkName),
    );
    evidence.isolation.setupNetwork = assertNetworkInspection(setupNetworkInspection, {
      name: names.setupNetworkName,
      internal: false,
      runId,
    });

    const gatewayPort = options.gatewayPortFactory?.() ?? allocateRandomGatewayPort();
    invariant(gatewayPort !== DEFAULT_USER_GATEWAY_PORT, 'GATEWAY_PORT_INVALID', 'Gateway must never use the user default port');
    evidence.isolation.isolatedGatewayPort = gatewayPort;

    for (const plannedStep of bootstrapPlan(bundle.metadata, gatewayPort)) {
      const containerName = collaborationBootstrapContainerName(runId, plannedStep.id);
      resources.bootstrapContainerNames.add(containerName);
      const result = await step(`bootstrap-${plannedStep.id}`, () => docker.runBootstrap({
        containerName,
        networkName: names.setupNetworkName,
        volumeName: names.volumeName,
        archivePath: plannedStep.archive ? bundle.archivePath : undefined,
        autoRemove: plannedStep.keepContainer !== true,
        openclawArgs: plannedStep.args,
        timeoutMs: plannedStep.timeoutMs,
      }));
      if (plannedStep.id === 'validate-config') {
        evidence.configValidation = parseJsonOutput(result.stdout, 'openclaw config validate');
      }
      if (plannedStep.id === 'inspect-plugin') {
        evidence.pluginInspection = parseJsonOutput(result.stdout, 'openclaw plugins inspect');
      }
      if (plannedStep.id === 'install') {
        const installMounts = await step('inspect-installer-mounts', () => docker.containerMounts(containerName));
        evidence.isolation.installerMounts = assertInstallMountAllowlist(
          installMounts,
          names.volumeName,
          bundle.archivePath,
        );
        const installSecurity = await step('inspect-installer-security', () => docker.containerSecurity(containerName));
        evidence.isolation.installerSecurity = assertContainerSecurity(installSecurity, names.setupNetworkName);
        await step('remove-installer-container', () => docker.removeOwnedContainer(containerName));
        resources.bootstrapContainerNames.delete(containerName);
      }
    }

    await step('remove-setup-network', () => docker.removeOwnedNetwork(names.setupNetworkName));
    resources.setupNetworkName = null;
    await step('create-runtime-network', () => docker.createNetwork(names.runtimeNetworkName, true));
    const runtimeNetworkInspection = await step(
      'inspect-runtime-network',
      () => docker.networkInspection(names.runtimeNetworkName),
    );
    evidence.isolation.runtimeNetwork = assertNetworkInspection(runtimeNetworkInspection, {
      name: names.runtimeNetworkName,
      internal: true,
      runId,
    });

    await step('start-gateway', () => docker.startGateway({
      containerName: names.gatewayContainerName,
      networkName: names.runtimeNetworkName,
      volumeName: names.volumeName,
      gatewayPort,
    }));
    const readinessProbe = options.readinessProbe ?? waitForGatewayReady;
    evidence.readiness = {
      initial: await step(
        'wait-initial-readiness',
        () => readinessProbe(docker, names.gatewayContainerName),
      ),
    };

    const runtimeMounts = await step('inspect-runtime-mounts', () => docker.containerMounts(names.gatewayContainerName));
    evidence.isolation.runtimeMounts = assertRuntimeMountAllowlist(runtimeMounts, names.volumeName);
    const runtimeSecurity = await step('inspect-runtime-security', () => docker.containerSecurity(names.gatewayContainerName));
    evidence.isolation.runtimeSecurity = assertContainerSecurity(
      runtimeSecurity,
      names.runtimeNetworkName,
      { gatewayPort, token },
    );
    const initialProcessList = await step(
      'inspect-runtime-process-arguments',
      () => docker.processList(names.gatewayContainerName),
    );
    evidence.isolation.runtimeProcessArguments = assertProcessArgumentsSecure(
      initialProcessList,
      token,
    );

    const openclawVersion = await step('verify-openclaw-version', () => docker.openclawVersion(names.gatewayContainerName));
    invariant(
      openclawVersion.includes(`OpenClaw ${OFFICIAL_OPENCLAW_VERSION}`),
      'RUNTIME_VERSION_MISMATCH',
      `Container did not report OpenClaw ${OFFICIAL_OPENCLAW_VERSION}`,
    );
    evidence.image.reportedVersion = openclawVersion;

    const firstResponse = await step(
      'capabilities-before-restart',
      () => callCapabilitiesWithRetry(docker, names.gatewayContainerName),
    );
    const firstCapabilities = assertCapabilities(firstResponse, bundle.metadata);
    evidence.capabilities = { beforeRestart: summarizeCapabilities(firstCapabilities) };

    const databasePaths = await step(
      'discover-collaboration-sqlite',
      () => docker.findCollaborationDatabases(names.gatewayContainerName),
    );
    invariant(Array.isArray(databasePaths) && databasePaths.length === 1, 'SQLITE_DISCOVERY_FAILED', 'Expected exactly one collaboration SQLite database', {
      databasePaths,
    });
    const sqlitePath = databasePaths[0];
    invariant(
      typeof sqlitePath === 'string' && sqlitePath.startsWith(`${CONTAINER_STATE_DIRECTORY}/`),
      'SQLITE_PATH_INVALID',
      'Collaboration SQLite database is outside isolated OpenClaw state',
    );
    const sqliteInspection = await step(
      'inspect-collaboration-sqlite',
      () => docker.inspectSqlite(names.gatewayContainerName, sqlitePath),
    );
    assertSqliteInspection(sqliteInspection, firstCapabilities, bundle.metadata);
    evidence.sqlite = { path: sqlitePath, ...sqliteInspection };

    await step('restart-gateway', () => docker.restart(names.gatewayContainerName));
    evidence.readiness.afterRestart = await step(
      'wait-restart-readiness',
      () => readinessProbe(docker, names.gatewayContainerName),
    );
    const secondResponse = await step(
      'capabilities-after-restart',
      () => callCapabilitiesWithRetry(docker, names.gatewayContainerName),
    );
    const secondCapabilities = assertCapabilities(secondResponse, bundle.metadata);
    assertCapabilitiesStable(firstCapabilities, secondCapabilities);
    evidence.capabilities.afterRestart = summarizeCapabilities(secondCapabilities);
    const restartedDatabasePaths = await step(
      'discover-collaboration-sqlite-after-restart',
      () => docker.findCollaborationDatabases(names.gatewayContainerName),
    );
    invariant(
      Array.isArray(restartedDatabasePaths)
        && restartedDatabasePaths.length === 1
        && restartedDatabasePaths[0] === sqlitePath,
      'SQLITE_DISCOVERY_FAILED',
      'Collaboration SQLite database changed across Gateway restart',
      { beforeRestart: [sqlitePath], afterRestart: restartedDatabasePaths },
    );
    const restartedSqliteInspection = await step(
      'inspect-collaboration-sqlite-after-restart',
      () => docker.inspectSqlite(names.gatewayContainerName, sqlitePath),
    );
    assertSqliteInspection(restartedSqliteInspection, secondCapabilities, bundle.metadata);
    evidence.sqlite.afterRestart = restartedSqliteInspection;
    const restartedProcessList = await step(
      'inspect-restarted-process-arguments',
      () => docker.processList(names.gatewayContainerName),
    );
    evidence.isolation.restartedProcessArguments = assertProcessArgumentsSecure(
      restartedProcessList,
      token,
    );
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
    persistedEvidence = redactedClone(evidence, secrets);
    if (persistedEvidence.failure) {
      await writeFile(failureLogPath, safeJson(persistedEvidence.failure), { mode: 0o600 });
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
    'Usage: node scripts/verify-collaboration-real-gateway.mjs [options]',
    '',
    'Options:',
    '  --evidence-root <path>  Parent directory for per-run evidence',
    '  --docker-binary <path>  Docker CLI binary (default: docker)',
    '  --help                  Show this help',
    '',
    'This is a structural real-Gateway smoke only. It never marks P0 behavior verified.',
  ].join('\n');
}

export function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
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
    const options = parseCliArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      const result = await runStructuralGatewaySmoke(options);
      console.log(JSON.stringify({
        status: result.evidence.status,
        scope: result.evidence.scope,
        runId: result.evidence.runId,
        evidencePath: result.evidencePath,
      }));
    }
  } catch (error) {
    const output = {
      status: 'FAILED',
      code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
      ...(error?.evidencePath ? { evidencePath: error.evidencePath } : {}),
    };
    console.error(JSON.stringify(output));
    process.exitCode = 1;
  }
}
