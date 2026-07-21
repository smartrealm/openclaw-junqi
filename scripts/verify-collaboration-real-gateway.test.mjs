import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  COLLABORATION_ARCHIVE_DESTINATION,
  CONTAINER_HOME,
  DEFAULT_USER_GATEWAY_PORT,
  DOCKER_OWNER_LABEL,
  DockerRuntime,
  OFFICIAL_OPENCLAW_IMAGE,
  OFFICIAL_OPENCLAW_IMAGE_DIGEST,
  OFFICIAL_OPENCLAW_VERSION,
  StructuralSmokeFailure,
  assertCapabilities,
  assertCapabilitiesStable,
  assertContainerSecurity,
  assertInstallMountAllowlist,
  assertNoDevFlag,
  assertRuntimeMountAllowlist,
  buildGatewayRunArgs,
  buildIsolationDockerArgs,
  loadAndValidateBundle,
  redactSensitive,
  runStructuralGatewaySmoke,
  sha256,
} from './verify-collaboration-real-gateway.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function metadataFor(bytes) {
  return {
    formatVersion: 1,
    pluginId: 'junqi-collab',
    packageName: '@junqi/openclaw-collaboration',
    pluginVersion: '0.3.0',
    schemaVersion: 10,
    sha256: sha256(bytes),
    archiveFile: 'junqi-collab.tgz',
    resourcePath: 'collaboration/junqi-collab.tgz',
  };
}

function capabilities(instanceId = 'instance-structural-smoke') {
  return {
    collaborationInstanceId: instanceId,
    pluginId: 'junqi-collab',
    pluginVersion: '0.3.0',
    schemaVersion: 10,
    runtimeVersion: '2026.7.1',
    databaseIntegrity: 'ok',
    configured: true,
    durableState: true,
    durableRuntime: { supported: true, required: true, reason: null },
    trustTier: 'portable-core',
    workboard: { supported: false, reason: 'trusted-official runtime is not available' },
    sessionCapabilities: {
      deleteExpectedSessionId: true,
      resetExpectedSessionId: false,
    },
    features: [
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
    ],
    featureEvidence: {
      kind: 'DECLARED_PLUGIN_CONTRACT',
      behaviorVerified: false,
      structuralChecks: {
        pluginServiceStarted: true,
        databaseIntegrity: 'ok',
        configured: true,
      },
      requiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
    },
    coordinatorAgentId: 'coordinator',
    allowedAgentIds: ['coordinator', 'worker'],
  };
}

class FakeDockerRuntime {
  constructor({ runId, archivePath, token, failAtVersion = false }) {
    this.runId = runId;
    this.archivePath = archivePath;
    this.token = token;
    this.failAtVersion = failAtVersion;
    this.events = [];
    this.networks = new Map();
    this.bootstrapCalls = [];
    this.removedContainers = [];
    this.removedNetworks = [];
    this.removedVolumes = [];
  }

  async preflight() {
    this.events.push('preflight');
    return { client: '29.4.0', server: '29.6.1', os: 'linux', architecture: 'arm64' };
  }

  async pullImage() {
    this.events.push('pull-image');
    return { id: 'sha256:platform-image', repoDigests: [OFFICIAL_OPENCLAW_IMAGE], os: 'linux', architecture: 'arm64' };
  }

  async createVolume(name) {
    this.volumeName = name;
    this.events.push(`create-volume:${name}`);
  }

  async createNetwork(name, internal) {
    this.networks.set(name, internal);
    this.events.push(`create-network:${internal ? 'internal' : 'egress'}:${name}`);
  }

  async networkInspection(name) {
    return {
      name,
      internal: this.networks.get(name),
      driver: 'bridge',
      labels: { [DOCKER_OWNER_LABEL]: this.runId },
    };
  }

  async runBootstrap(options) {
    this.bootstrapCalls.push(options);
    this.events.push(`bootstrap:${options.openclawArgs.join(' ')}`);
    if (options.openclawArgs.includes('validate')) return { stdout: '{"valid":true}', stderr: '' };
    if (options.openclawArgs.includes('inspect')) {
      return { stdout: '{"id":"junqi-collab","enabled":true}', stderr: '' };
    }
    return { stdout: '{}', stderr: '' };
  }

  async startGateway(options) {
    this.startOptions = options;
    this.events.push(`start-gateway:${options.gatewayPort}`);
    return 'fake-container-id';
  }

  async containerMounts(name) {
    if (name.endsWith('-install')) {
      return [
        {
          Type: 'volume',
          Name: this.volumeName,
          Destination: CONTAINER_HOME,
          RW: true,
        },
        {
          Type: 'bind',
          Source: this.archivePath,
          Destination: COLLABORATION_ARCHIVE_DESTINATION,
          RW: false,
        },
      ];
    }
    return [{
      Type: 'volume',
      Name: this.volumeName,
      Destination: CONTAINER_HOME,
      RW: true,
    }];
  }

  async containerSecurity(name) {
    const gateway = name.endsWith('-gateway');
    return {
      readonlyRootfs: true,
      capDrop: ['ALL'],
      securityOpt: ['no-new-privileges:true'],
      networkMode: gateway ? this.startOptions.networkName : this.bootstrapCalls.at(-1).networkName,
      tmpfs: { '/tmp': 'rw,nosuid,nodev,size=268435456' },
      portBindings: {},
      command: gateway
        ? [
            'openclaw', '--no-color', 'gateway', 'run', '--auth', 'token',
            '--bind', 'loopback', '--port', String(this.startOptions.gatewayPort),
          ]
        : ['openclaw', '--no-color', 'plugins', 'install', 'npm-pack:/run/junqi-input/junqi-collab.tgz'],
      user: 'node',
    };
  }

  async gatewayHealth() {
    return { ok: true };
  }

  async processList() {
    return 'PID ARGS\n1 /sbin/docker-init -- openclaw gateway run --port 53111\n';
  }

  async openclawVersion() {
    if (this.failAtVersion) throw new Error(`version probe failed with ${this.token}`);
    return 'OpenClaw 2026.7.1 (test)';
  }

  async gatewayCall() {
    return capabilities();
  }

  async findCollaborationDatabases() {
    return ['/home/node/.openclaw/junqi-collab/collaboration.sqlite'];
  }

  async inspectSqlite() {
    return {
      integrity: 'ok',
      schemaVersion: 10,
      collaborationInstanceId: 'instance-structural-smoke',
      authorityTablePresent: true,
    };
  }

  async restart() {
    this.events.push('restart-gateway');
  }

  async logs() {
    return `gateway started token=${this.token}\n`;
  }

  async removeOwnedContainer(name) {
    this.removedContainers.push(name);
    this.events.push(`remove-container:${name}`);
    return { kind: 'container', name, removed: true, missing: false };
  }

  async removeOwnedNetwork(name) {
    this.removedNetworks.push(name);
    this.events.push(`remove-network:${name}`);
    return { kind: 'network', name, removed: true, missing: false };
  }

  async removeOwnedVolume(name) {
    this.removedVolumes.push(name);
    this.events.push(`remove-volume:${name}`);
    return { kind: 'volume', name, removed: true, missing: false };
  }
}

describe('collaboration bundle verification', () => {
  test('requires byte-identical metadata and archives with a matching hash', async () => {
    const root = await temporaryDirectory('junqi-real-gateway-bundle-');
    const archive = Buffer.from('deterministic collaboration archive');
    const metadata = metadataFor(archive);
    const resourceMetadataPath = path.join(root, 'metadata.json');
    const generatedMetadataPath = path.join(root, 'generated.json');
    const resourceArchivePath = path.join(root, 'junqi-collab.tgz');
    const packedArchivePath = path.join(root, 'packed.tgz');
    const metadataJson = `${JSON.stringify(metadata, null, 2)}\n`;
    await Promise.all([
      writeFile(resourceMetadataPath, metadataJson),
      writeFile(generatedMetadataPath, metadataJson),
      writeFile(resourceArchivePath, archive),
      writeFile(packedArchivePath, archive),
    ]);

    const result = await loadAndValidateBundle({
      repositoryRoot: root,
      resourceMetadataPath,
      generatedMetadataPath,
      resourceArchivePath,
      packedArchivePath,
    });
    assert.equal(result.metadata.sha256, metadata.sha256);
    assert.equal(result.archiveSize, archive.byteLength);

    await writeFile(resourceArchivePath, Buffer.from('substituted archive'));
    await assert.rejects(
      loadAndValidateBundle({
        repositoryRoot: root,
        resourceMetadataPath,
        generatedMetadataPath,
        resourceArchivePath,
        packedArchivePath,
      }),
      /does not match metadata/,
    );
  });
});

describe('Docker isolation contract', () => {
  test('pins the reviewed official OpenClaw release by immutable digest', () => {
    assert.equal(OFFICIAL_OPENCLAW_VERSION, '2026.7.1');
    assert.equal(
      OFFICIAL_OPENCLAW_IMAGE_DIGEST,
      'sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c',
    );
    assert.equal(
      OFFICIAL_OPENCLAW_IMAGE,
      `ghcr.io/openclaw/openclaw:${OFFICIAL_OPENCLAW_VERSION}@${OFFICIAL_OPENCLAW_IMAGE_DIGEST}`,
    );
  });

  test('uses isolated paths, read-only root, security flags, and token env forwarding', () => {
    const token = 'this-token-must-not-appear-in-argv';
    const base = buildIsolationDockerArgs({
      containerName: 'junqi-smoke-bootstrap',
      networkName: 'junqi-smoke-setup',
      volumeName: 'junqi-smoke-home',
      runId: 'run-1',
      kind: 'bootstrap',
      autoRemove: true,
      archivePath: '/tmp/junqi-collab.tgz',
      forwardGatewayToken: true,
    });
    assert.ok(base.includes('--read-only'));
    assert.deepEqual(base.slice(base.indexOf('--cap-drop'), base.indexOf('--cap-drop') + 2), ['--cap-drop', 'ALL']);
    assert.ok(base.includes('no-new-privileges:true'));
    assert.ok(base.includes('HOME=/home/node'));
    assert.ok(base.includes('XDG_CONFIG_HOME=/home/node/.config'));
    assert.ok(base.includes('TMPDIR=/tmp'));
    assert.ok(base.includes('OPENCLAW_GATEWAY_TOKEN'));
    assert.equal(base.some((argument) => argument.includes(token)), false);
    assert.equal(base.some((argument) => argument.includes(`${os.homedir()}/.openclaw`)), false);

    const installer = buildIsolationDockerArgs({
      containerName: 'junqi-smoke-installer',
      networkName: 'junqi-smoke-setup',
      volumeName: 'junqi-smoke-home',
      runId: 'run-1',
      kind: 'bootstrap',
      autoRemove: false,
      archivePath: '/tmp/junqi-collab.tgz',
    });
    assert.equal(installer.includes('OPENCLAW_GATEWAY_TOKEN'), false);
  });

  test('exposes the generated token only to the Gateway Docker invocation', async () => {
    const token = 'd'.repeat(64);
    const environments = [];
    const runner = {
      async run(_command, _args, options) {
        environments.push(options.env);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const runtime = new DockerRuntime({ runner, token, runId: 'run-1' });

    await runtime.run(['version']);
    await runtime.run(['run'], { forwardGatewayToken: true });

    assert.equal(environments[0].OPENCLAW_GATEWAY_TOKEN, undefined);
    assert.equal(environments[1].OPENCLAW_GATEWAY_TOKEN, token);
  });

  test('runtime uses a random isolated port and never publishes a host port or token', () => {
    const args = buildGatewayRunArgs({
      containerName: 'junqi-smoke-gateway',
      networkName: 'junqi-smoke-runtime',
      volumeName: 'junqi-smoke-home',
      runId: 'run-1',
      kind: 'gateway',
      gatewayPort: 53_111,
    });
    assert.ok(args.includes(OFFICIAL_OPENCLAW_IMAGE));
    assert.equal(args.includes('--publish'), false);
    assert.equal(args.includes('--token'), false);
    assert.equal(args.includes(String(DEFAULT_USER_GATEWAY_PORT)), false);
    assert.equal(args[args.indexOf('--bind') + 1], 'loopback');
    assert.equal(args[args.indexOf('--port') + 1], '53111');
    assert.throws(() => assertNoDevFlag([...args, '--dev']), /must never use --dev/);
  });

  test('rejects unexpected mounts and insecure process configuration', () => {
    const runtimeMounts = [{
      Type: 'volume', Name: 'smoke-home', Destination: CONTAINER_HOME, RW: true,
    }];
    assert.deepEqual(assertRuntimeMountAllowlist(runtimeMounts, 'smoke-home'), [{
      type: 'volume', name: 'smoke-home', destination: CONTAINER_HOME, readWrite: true,
    }]);
    assert.throws(
      () => assertRuntimeMountAllowlist([...runtimeMounts, {
        Type: 'bind', Source: os.homedir(), Destination: '/host-home', RW: true,
      }], 'smoke-home'),
      /unexpected mounts/,
    );

    const archive = '/tmp/final.tgz';
    assert.equal(assertInstallMountAllowlist([
      ...runtimeMounts,
      { Type: 'bind', Source: archive, Destination: COLLABORATION_ARCHIVE_DESTINATION, RW: false },
    ], 'smoke-home', archive).length, 2);
    assert.equal(assertInstallMountAllowlist([
      ...runtimeMounts,
      {
        Type: 'bind',
        Source: `/host_mnt${archive}`,
        Destination: COLLABORATION_ARCHIVE_DESTINATION,
        RW: false,
      },
    ], 'smoke-home', archive).length, 2);
    assert.throws(
      () => assertInstallMountAllowlist([
        ...runtimeMounts,
        {
          Type: 'bind', Source: `/untrusted${archive}`, Destination: COLLABORATION_ARCHIVE_DESTINATION, RW: false,
        },
      ], 'smoke-home', archive),
      /archive source is wrong/,
    );

    const security = {
      readonlyRootfs: true,
      capDrop: ['ALL'],
      securityOpt: ['no-new-privileges:true'],
      networkMode: 'smoke-runtime',
      tmpfs: { '/tmp': 'rw,nosuid,nodev,size=268435456' },
      portBindings: {},
      command: ['openclaw', 'gateway', 'run', '--port', '53111'],
      user: 'node',
    };
    assert.equal(
      assertContainerSecurity(security, 'smoke-runtime', { gatewayPort: 53_111, token: 'secret' }).hostPortPublished,
      false,
    );
    assert.throws(
      () => assertContainerSecurity({ ...security, command: [...security.command, '--token', 'secret'] }, 'smoke-runtime', {
        gatewayPort: 53_111,
        token: 'secret',
      }),
      /token must not appear/,
    );
  });
});

describe('capability and restart evidence', () => {
  test('accepts only the structural portable-core contract and stable instance identity', () => {
    const metadata = metadataFor(Buffer.from('archive'));
    const first = assertCapabilities(capabilities(), metadata);
    const second = assertCapabilities(capabilities(), metadata);
    assert.doesNotThrow(() => assertCapabilitiesStable(first, second));
    assert.throws(
      () => assertCapabilities({ ...capabilities(), featureEvidence: {
        ...capabilities().featureEvidence,
        behaviorVerified: true,
      } }, metadata),
      /must not claim behavioral verification/,
    );
    assert.throws(
      () => assertCapabilitiesStable(first, capabilities('replacement-instance')),
      /instance id changed/i,
    );
  });
});

describe('structural smoke orchestration', () => {
  test('runs install, internal runtime, restart, evidence, and finally cleanup', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-real-gateway-evidence-');
    const runId = '20260717-success01';
    const token = 'a'.repeat(64);
    const bundle = {
      metadata: metadataFor(Buffer.from('archive')),
      archivePath: '/tmp/final-junqi-collab.tgz',
      archiveSize: 7,
    };
    const docker = new FakeDockerRuntime({
      runId,
      archivePath: bundle.archivePath,
      token,
    });

    const result = await runStructuralGatewaySmoke({
      runId,
      bundle,
      dockerRuntime: docker,
      evidenceRoot,
      tokenFactory: () => token,
      gatewayPortFactory: () => 53_111,
      readinessProbe: async () => ({ attempts: 1, durationMs: 1, health: { ok: true } }),
    });

    assert.equal(result.evidence.status, 'PASSED');
    assert.equal(result.evidence.p0BehaviorVerified, false);
    assert.equal(result.evidence.isolation.runtimeNetwork.internal, true);
    assert.equal(result.evidence.isolation.hostPortPublished, false);
    assert.equal(result.evidence.isolation.isolatedGatewayPort, 53_111);
    assert.ok(docker.bootstrapCalls.some((call) => call.openclawArgs.some(
      (argument) => argument === `npm-pack:${COLLABORATION_ARCHIVE_DESTINATION}`,
    )));
    assert.ok(docker.bootstrapCalls.some((call) => call.openclawArgs.includes('plugins.allow')));
    assert.ok(docker.events.indexOf('restart-gateway') > docker.events.findIndex((event) => event.startsWith('start-gateway:')));
    assert.ok(docker.events.includes('restart-gateway'));
    assert.ok(result.evidence.sqlite.afterRestart);
    assert.ok(docker.removedContainers.some((name) => name.endsWith('-gateway')));
    assert.equal(docker.removedVolumes.length, 1);
    assert.ok(docker.removedNetworks.some((name) => name.endsWith('-runtime')));

    const evidenceText = await readFile(result.evidencePath, 'utf8');
    const gatewayLog = await readFile(result.gatewayLogPath, 'utf8');
    assert.equal(evidenceText.includes(token), false);
    assert.equal(gatewayLog.includes(token), false);
    assert.match(gatewayLog, /\[REDACTED\]/);
  });

  test('preserves redacted failure evidence and still cleans every owned resource', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-real-gateway-failure-');
    const runId = '20260717-failure01';
    const token = 'b'.repeat(64);
    const bundle = {
      metadata: metadataFor(Buffer.from('archive')),
      archivePath: '/tmp/final-junqi-collab.tgz',
      archiveSize: 7,
    };
    const docker = new FakeDockerRuntime({
      runId,
      archivePath: bundle.archivePath,
      token,
      failAtVersion: true,
    });

    await assert.rejects(
      runStructuralGatewaySmoke({
        runId,
        bundle,
        dockerRuntime: docker,
        evidenceRoot,
        tokenFactory: () => token,
        gatewayPortFactory: () => 53_112,
        readinessProbe: async () => ({ attempts: 1, durationMs: 1, health: { ok: true } }),
      }),
      StructuralSmokeFailure,
    );

    const evidencePath = path.join(evidenceRoot, runId, 'evidence.json');
    const evidenceText = await readFile(evidencePath, 'utf8');
    const evidence = JSON.parse(evidenceText);
    const gatewayLog = await readFile(path.join(evidenceRoot, runId, 'gateway.log'), 'utf8');
    assert.equal(evidence.status, 'FAILED');
    assert.equal(evidenceText.includes(token), false);
    assert.equal(gatewayLog.includes(token), false);
    assert.match(evidence.failure.message, /\[REDACTED\]/);
    assert.ok(docker.removedContainers.some((name) => name.endsWith('-gateway')));
    assert.ok(docker.removedNetworks.some((name) => name.endsWith('-runtime')));
    assert.equal(docker.removedVolumes.length, 1);
  });

  test('rejects unsafe run ids and weak injected Gateway tokens before Docker work', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-real-gateway-input-');
    await assert.rejects(
      runStructuralGatewaySmoke({
        runId: '../host-profile',
        evidenceRoot,
        tokenFactory: () => 'c'.repeat(64),
      }),
      /Run id must contain only/,
    );
    await assert.rejects(
      runStructuralGatewaySmoke({
        runId: '20260717-invalid-token',
        evidenceRoot,
        tokenFactory: () => 'weak-token',
      }),
      /32-byte lowercase hexadecimal/,
    );
  });
});

test('redaction removes concrete and structured secret forms', () => {
  const secret = 'abc123-secret';
  const output = redactSensitive(
    `raw ${secret} OPENCLAW_GATEWAY_TOKEN=${secret} {"token":"${secret}"}`,
    [secret],
  );
  assert.equal(output.includes(secret), false);
  assert.match(output, /\[REDACTED\]/);
});
