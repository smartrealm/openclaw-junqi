import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { promisify } from 'node:util';

import {
  CONTAINER_HOME,
  DOCKER_OWNER_LABEL,
  DockerRuntime,
  OFFICIAL_OPENCLAW_IMAGE,
  OFFICIAL_OPENCLAW_VERSION,
  StructuralSmokeFailure,
  buildIsolationDockerArgs,
  sha256,
} from './verify-collaboration-real-gateway.mjs';
import {
  DINGTALK_ARCHIVE_DESTINATION,
  DINGTALK_DWS_FIXTURE_DESTINATION,
  DingTalkDockerRuntime,
  assertDisabledDingTalkSnapshot,
  assertDingTalkEffectiveReadTool,
  assertDingTalkFixtureReadInvocation,
  assertDwsFixtureRuntimeMountAllowlist,
  assertNoDwsProcess,
  assertScopedReadSuccess,
  assertWriteOnlyScopeDenied,
  dingTalkBootstrapPlan,
  loadAndValidateDingTalkBundle,
  parseDingTalkSmokeCliArguments,
  runDingTalkGatewaySmoke,
} from './verify-dingtalk-real-gateway.mjs';

const temporaryDirectories = [];
const execFileAsync = promisify(execFile);
const fixtureScriptPath = path.resolve('scripts/fixtures/dingtalk-gateway-dws-fixture.js');

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
    formatVersion: 2,
    pluginId: 'junqi-dingtalk',
    packageName: '@junqi/openclaw-dingtalk-business',
    pluginVersion: '0.21.0',
    pluginApiRange: '>=2026.8.1',
    minimumGatewayVersion: '2026.8.1',
    toolCount: 85,
    sha256: sha256(bytes),
    archiveFile: 'junqi-dingtalk.tgz',
    resourcePath: 'dingtalk/junqi-dingtalk.tgz',
  };
}

function disabledSnapshot(generation = '11111111-1111-4111-8111-111111111111') {
  return {
    runtimeGeneration: generation,
    configurationDigest: createHash('sha256').update('[null,100,[]]').digest('hex'),
    configured: false,
    phase: 'disabled',
    profileRef: null,
    subscriptionCount: 0,
    activeConsumerCount: 0,
    readyConsumerCount: 0,
    eventKeys: [],
    contractDigest: null,
    latestSequence: 0,
    oldestSequence: null,
    droppedCount: 0,
    rejectedCount: 0,
    lastErrorCode: null,
    events: [],
  };
}

class FakeDingTalkDockerRuntime {
  constructor({ runId, archivePath, token, failAtSnapshot = false, failAtEffectiveTools = false }) {
    this.runId = runId;
    this.archivePath = archivePath;
    this.token = token;
    this.failAtSnapshot = failAtSnapshot;
    this.failAtEffectiveTools = failAtEffectiveTools;
    this.networks = new Map();
    this.bootstrapCalls = [];
    this.events = [];
    this.removedContainers = [];
    this.removedNetworks = [];
    this.removedVolumes = [];
    this.restartCount = 0;
    this.scopedGatewayCalls = [];
  }

  async preflight() {
    return { client: 'test', server: 'test', os: 'linux', architecture: 'arm64' };
  }

  async pullImage() {
    return { id: 'sha256:test', repoDigests: [OFFICIAL_OPENCLAW_IMAGE], os: 'linux', architecture: 'arm64' };
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
      return { stdout: '{"id":"junqi-dingtalk","enabled":true}', stderr: '' };
    }
    return { stdout: '{}', stderr: '' };
  }

  async startGateway(options) {
    this.startOptions = options;
    this.events.push(`start-gateway:${options.gatewayPort}`);
    return 'fake-container';
  }

  async containerMounts(name) {
    if (name.endsWith('-install')) {
      return [
        { Type: 'volume', Name: this.volumeName, Destination: CONTAINER_HOME, RW: true },
        { Type: 'bind', Source: this.archivePath, Destination: DINGTALK_ARCHIVE_DESTINATION, RW: false },
      ];
    }
    return [
      { Type: 'volume', Name: this.volumeName, Destination: CONTAINER_HOME, RW: true },
      ...(this.startOptions.dwsFixturePath ? [{
        Type: 'bind',
        Source: this.startOptions.dwsFixturePath,
        Destination: DINGTALK_DWS_FIXTURE_DESTINATION,
        RW: false,
      }] : []),
    ];
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
        ? ['openclaw', '--no-color', 'gateway', 'run', '--auth', 'token', '--bind', 'loopback', '--port', String(this.startOptions.gatewayPort)]
        : ['openclaw', '--no-color', 'plugins', 'install', `npm-pack:${DINGTALK_ARCHIVE_DESTINATION}`],
      user: 'node',
    };
  }

  async processList() {
    return 'PID ARGS\n1 /sbin/docker-init -- openclaw gateway run --port 53121\n';
  }

  async openclawVersion() {
    return `OpenClaw ${OFFICIAL_OPENCLAW_VERSION} (test)`;
  }

  async gatewayCallWithScopes(_name, gatewayPort, method, params, scopes) {
    this.scopedGatewayCalls.push({ gatewayPort, method, params, scopes });
    if (method === 'junqi.dingtalk.events.snapshot' && this.failAtSnapshot) {
      throw new Error(`snapshot failed with ${this.token}`);
    }
    if (method === 'junqi.dingtalk.events.snapshot' && scopes.includes('operator.write')) {
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          details: {
            code: 'MISSING_SCOPE',
            missingScope: 'operator.read',
            requiredScopes: ['operator.read'],
          },
        },
      };
    }
    if (method === 'junqi.dingtalk.events.snapshot') {
      return {
        ok: true,
        result: this.restartCount === 0
          ? disabledSnapshot()
          : disabledSnapshot('22222222-2222-4222-8222-222222222222'),
      };
    }
    if (method === 'sessions.create') {
      return {
        ok: true,
        result: {
          ok: true,
          key: params.key,
          sessionId: '33333333-3333-4333-8333-333333333333',
          runStarted: false,
        },
      };
    }
    if (method === 'tools.effective') {
      if (this.failAtEffectiveTools) {
        return { ok: true, result: { agentId: 'main', profile: 'coding', groups: [] } };
      }
      return {
        ok: true,
        result: {
          agentId: 'main',
          profile: 'coding',
          groups: [{
            id: 'plugin',
            label: 'Connected tools',
            source: 'plugin',
            tools: [{
              id: 'junqi_dingtalk_contact_me',
              label: '当前用户',
              description: '读取当前钉钉用户资料',
              rawDescription: '读取当前钉钉用户资料',
              source: 'plugin',
              pluginId: 'junqi-dingtalk',
              risk: 'low',
              tags: ['dingtalk', 'contact', 'read'],
            }],
          }],
        },
      };
    }
    if (method === 'tools.invoke') {
      const details = {
        success: true,
        toolName: 'junqi_dingtalk_contact_me',
        dwsCanonicalPath: 'contact.get_current_user_profile',
        profileRef: 'smoke:test-user',
        schemaDigest: 'd'.repeat(64),
        observedAt: '2026-09-09T12:00:00.000Z',
        data: {
          fixture: 'junqi-dingtalk-gateway-chain',
          userId: 'test-user',
        },
      };
      return {
        ok: true,
        result: {
          ok: true,
          toolName: 'junqi_dingtalk_contact_me',
          source: 'plugin',
          output: {
            content: [{ type: 'text', text: JSON.stringify(details) }],
            details,
          },
        },
      };
    }
    throw new Error(`Unexpected scoped Gateway method: ${method}`);
  }

  async restart() {
    this.restartCount += 1;
    this.events.push('restart-gateway');
  }

  async logs() {
    return `gateway started token=${this.token}\n`;
  }

  async removeOwnedContainer(name) {
    this.removedContainers.push(name);
    return { kind: 'container', name, removed: true, missing: false };
  }

  async removeOwnedNetwork(name) {
    this.removedNetworks.push(name);
    return { kind: 'network', name, removed: true, missing: false };
  }

  async removeOwnedVolume(name) {
    this.removedVolumes.push(name);
    return { kind: 'volume', name, removed: true, missing: false };
  }
}

describe('DingTalk fixed bundle verification', () => {
  test('requires byte-identical metadata and archives with a matching hash', async () => {
    const root = await temporaryDirectory('junqi-dingtalk-gateway-bundle-');
    const archive = Buffer.from('deterministic DingTalk archive');
    const metadata = metadataFor(archive);
    const resourceMetadataPath = path.join(root, 'metadata.json');
    const generatedMetadataPath = path.join(root, 'generated.json');
    const resourceArchivePath = path.join(root, 'junqi-dingtalk.tgz');
    const packedArchivePath = path.join(root, 'packed.tgz');
    const metadataJson = `${JSON.stringify(metadata, null, 2)}\n`;
    await Promise.all([
      writeFile(resourceMetadataPath, metadataJson),
      writeFile(generatedMetadataPath, metadataJson),
      writeFile(resourceArchivePath, archive),
      writeFile(packedArchivePath, archive),
    ]);
    const result = await loadAndValidateDingTalkBundle({
      repositoryRoot: root,
      resourceMetadataPath,
      generatedMetadataPath,
      resourceArchivePath,
      packedArchivePath,
    });
    assert.equal(result.metadata.sha256, metadata.sha256);
    assert.equal(result.archiveSize, archive.byteLength);
    await writeFile(resourceArchivePath, Buffer.from('substituted archive'));
    await assert.rejects(loadAndValidateDingTalkBundle({
      repositoryRoot: root,
      resourceMetadataPath,
      generatedMetadataPath,
      resourceArchivePath,
      packedArchivePath,
    }), /does not match metadata/);
  });
});

describe('DingTalk disabled Gateway contract', () => {
  test('accepts only the closed disabled snapshot and restart generation change', () => {
    const first = assertDisabledDingTalkSnapshot(disabledSnapshot());
    assert.doesNotThrow(() => assertDisabledDingTalkSnapshot(
      disabledSnapshot('22222222-2222-4222-8222-222222222222'),
      { previousGeneration: first.runtimeGeneration },
    ));
    assert.throws(
      () => assertDisabledDingTalkSnapshot({ ...disabledSnapshot(), extra: true }),
      /fields do not match/,
    );
    assert.throws(
      () => assertDisabledDingTalkSnapshot(disabledSnapshot(), { previousGeneration: first.runtimeGeneration }),
      /did not change/,
    );
  });

  test('requires operator.read success and structured operator.write-only denial', () => {
    assert.deepEqual(assertScopedReadSuccess({ ok: true, result: disabledSnapshot() }), disabledSnapshot());
    assert.deepEqual(assertWriteOnlyScopeDenied({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        details: {
          code: 'MISSING_SCOPE',
          missingScope: 'operator.read',
          requiredScopes: ['operator.read'],
        },
      },
    }), {
      code: 'FORBIDDEN',
      details: {
        code: 'MISSING_SCOPE',
        missingScope: 'operator.read',
        requiredScopes: ['operator.read'],
      },
    });
    assert.throws(
      () => assertWriteOnlyScopeDenied({ ok: true, result: disabledSnapshot() }),
      /unexpectedly authorized/,
    );
  });

  test('dispatches explicit scopes through the isolated container without forwarding the host token', async () => {
    const calls = [];
    const token = 'c'.repeat(64);
    const runtime = new DockerRuntime({
      token,
      runId: 'scope-probe-test',
      dockerBinary: 'docker-test',
      runner: {
        async run(command, args, options) {
          calls.push({ command, args, options });
          return { stdout: '{"ok":true,"result":{"configured":false}}', stderr: '' };
        },
      },
    });
    const result = await runtime.gatewayCallWithScopes(
      'isolated-gateway',
      53_121,
      'junqi.dingtalk.events.snapshot',
      { afterSequence: 0, limit: 20 },
      ['operator.read'],
    );
    assert.deepEqual(result, { ok: true, result: { configured: false } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'docker-test');
    assert.deepEqual(calls[0].args.slice(-4), [
      'ws://127.0.0.1:53121',
      'junqi.dingtalk.events.snapshot',
      '{"afterSequence":0,"limit":20}',
      '["operator.read"]',
    ]);
    assert.equal(calls[0].args.some((argument) => String(argument).includes(token)), false);
    assert.equal(calls[0].options.env.OPENCLAW_GATEWAY_TOKEN, undefined);
    await assert.rejects(
      runtime.gatewayCallWithScopes('isolated-gateway', 53_121, 'method', {}, ['invalid']),
      /scopes are invalid/,
    );
  });

  test('mounts the DingTalk archive at its own read-only destination', () => {
    const args = buildIsolationDockerArgs({
      containerName: 'junqi-dingtalk-installer',
      networkName: 'junqi-dingtalk-setup',
      volumeName: 'junqi-dingtalk-home',
      runId: 'run-1',
      kind: 'bootstrap',
      autoRemove: false,
      archivePath: '/tmp/junqi-dingtalk.tgz',
      archiveDestination: DINGTALK_ARCHIVE_DESTINATION,
    });
    assert.ok(args.includes(`type=bind,source=/tmp/junqi-dingtalk.tgz,target=${DINGTALK_ARCHIVE_DESTINATION},readonly`));
  });

  test('bootstrap configuration never supplies DWS paths, profiles, or subscriptions', () => {
    const plan = dingTalkBootstrapPlan(metadataFor(Buffer.from('archive')), 53_121);
    const serialized = JSON.stringify(plan);
    assert.match(serialized, /allowedAgentIds/);
    assert.equal(serialized.includes('dwsPath'), false);
    assert.equal(serialized.includes('eventProfile'), false);
    assert.equal(serialized.includes('eventSubscriptions'), false);
    assert.ok(plan.some((step) => step.args.includes(`npm-pack:${DINGTALK_ARCHIVE_DESTINATION}`)));
  });

  test('fixture chain config supplies only the deterministic DWS path beside Agent authorization', () => {
    const plan = dingTalkBootstrapPlan(metadataFor(Buffer.from('archive')), 53_121, {
      dwsPath: DINGTALK_DWS_FIXTURE_DESTINATION,
    });
    const serialized = JSON.stringify(plan);
    assert.match(serialized, /allowedAgentIds/);
    assert.match(serialized, /dwsPath/);
    assert.match(serialized, /dingtalk-gateway-dws-fixture\.js/);
    assert.equal(serialized.includes('eventProfile'), false);
    assert.equal(serialized.includes('eventSubscriptions'), false);
  });

  test('accepts only the exact read-only DWS fixture runtime mount', () => {
    const mounts = [
      { Type: 'volume', Name: 'fixture-home', Destination: CONTAINER_HOME, RW: true },
      { Type: 'bind', Source: '/tmp/dws-fixture.js', Destination: DINGTALK_DWS_FIXTURE_DESTINATION, RW: false },
    ];
    assert.equal(assertDwsFixtureRuntimeMountAllowlist(mounts, 'fixture-home', '/tmp/dws-fixture.js').length, 2);
    assert.throws(
      () => assertDwsFixtureRuntimeMountAllowlist([
        mounts[0],
        { ...mounts[1], RW: true },
      ], 'fixture-home', '/tmp/dws-fixture.js'),
      /not read-only/,
    );
    assert.throws(
      () => assertDwsFixtureRuntimeMountAllowlist([...mounts, {
        Type: 'bind', Source: '/tmp/extra', Destination: '/run/extra', RW: false,
      }], 'fixture-home', '/tmp/dws-fixture.js'),
      /unexpected mounts/,
    );
  });

  test('injects the fixture mount before the pinned Gateway image', async () => {
    const calls = [];
    const runtime = new DingTalkDockerRuntime({
      token: 'e'.repeat(64),
      runId: 'fixture-mount-test',
      dockerBinary: 'docker-test',
      runner: {
        async run(command, args, options) {
          calls.push({ command, args, options });
          return { stdout: 'container-id\n', stderr: '' };
        },
      },
    });
    await runtime.startGateway({
      containerName: 'fixture-gateway',
      networkName: 'fixture-runtime',
      volumeName: 'fixture-home',
      gatewayPort: 53_121,
      dwsFixturePath: '/tmp/dws-fixture.js',
    });
    const mount = `type=bind,source=/tmp/dws-fixture.js,target=${DINGTALK_DWS_FIXTURE_DESTINATION},readonly`;
    assert.ok(calls[0].args.includes(mount));
    assert.ok(calls[0].args.indexOf(mount) < calls[0].args.indexOf(OFFICIAL_OPENCLAW_IMAGE));
    assert.equal(calls[0].options.forwardGatewayToken, undefined);
    assert.equal(calls[0].options.env.OPENCLAW_GATEWAY_TOKEN, 'e'.repeat(64));
  });

  test('validates effective ownership and the closed fixture invocation result', () => {
    const tool = {
      id: 'junqi_dingtalk_contact_me',
      source: 'plugin',
      pluginId: 'junqi-dingtalk',
    };
    assert.deepEqual(assertDingTalkEffectiveReadTool({
      agentId: 'main',
      groups: [{ source: 'plugin', tools: [tool] }],
    }), {
      agentId: 'main',
      toolName: 'junqi_dingtalk_contact_me',
      pluginId: 'junqi-dingtalk',
    });
    assert.throws(
      () => assertDingTalkEffectiveReadTool({
        agentId: 'main',
        groups: [{ source: 'plugin', tools: [{ ...tool, deniedBySession: true }] }],
      }),
      /denied by the isolated session/,
    );

    const details = {
      success: true,
      toolName: 'junqi_dingtalk_contact_me',
      dwsCanonicalPath: 'contact.get_current_user_profile',
      profileRef: 'smoke:test-user',
      schemaDigest: 'f'.repeat(64),
      observedAt: '2026-09-09T12:00:00.000Z',
      data: { fixture: 'junqi-dingtalk-gateway-chain', userId: 'test-user' },
    };
    const invocation = {
      ok: true,
      toolName: 'junqi_dingtalk_contact_me',
      source: 'plugin',
      output: { content: [{ type: 'text', text: JSON.stringify(details) }], details },
    };
    assert.equal(assertDingTalkFixtureReadInvocation(invocation).schemaDigest, 'f'.repeat(64));
    assert.throws(
      () => assertDingTalkFixtureReadInvocation({
        ...invocation,
        output: { ...invocation.output, details: { ...details, data: { fixture: 'wrong' } } },
      }),
      /unexpected fixture payload/,
    );
  });

  test('fixture process accepts only the exact schema and current-user read commands', async () => {
    const schema = await execFileAsync(process.execPath, [
      fixtureScriptPath,
      'schema',
      'contact.get_current_user_profile',
      '--format',
      'json',
    ]);
    assert.deepEqual(JSON.parse(schema.stdout), {
      availability: 'available',
      canonical_path: 'contact.get_current_user_profile',
      cli_path: 'contact user get-self',
      effect: 'read',
      risk: 'low',
      confirmation: 'not_required',
      idempotency: 'idempotent',
      parameters: {},
    });
    const business = await execFileAsync(process.execPath, [
      fixtureScriptPath,
      '--profile',
      'smoke:test-user',
      'contact',
      'user',
      'get-self',
      '--format',
      'json',
    ]);
    assert.deepEqual(JSON.parse(business.stdout), {
      ok: true,
      outcome: 'success',
      data: { fixture: 'junqi-dingtalk-gateway-chain', userId: 'test-user' },
    });
    await assert.rejects(
      execFileAsync(process.execPath, [fixtureScriptPath, 'profile', 'list']),
      (error) => error.code === 2 && /Unsupported deterministic/.test(error.stderr),
    );
  });

  test('CLI exposes fixture chain mode without accepting arbitrary arguments', () => {
    assert.deepEqual(parseDingTalkSmokeCliArguments(['--fixture-plugin-chain']), {
      fixturePluginChain: true,
    });
    assert.throws(
      () => parseDingTalkSmokeCliArguments(['--dws-path', '/tmp/dws']),
      /Unknown argument/,
    );
  });

  test('disabled runtime process inspection rejects any DWS child', () => {
    assert.deepEqual(assertNoDwsProcess('PID ARGS\n1 openclaw gateway run\n'), { dwsProcessRows: 0 });
    assert.throws(
      () => assertNoDwsProcess('PID ARGS\n1 node /opt/dws.js event consume\n'),
      /DWS process started/,
    );
  });
});

describe('DingTalk real Gateway smoke orchestration', () => {
  test('proves fixed installation, disabled RPC, restart fence, and cleanup', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-dingtalk-gateway-evidence-');
    const runId = '20260909-success01';
    const token = 'a'.repeat(64);
    const bundle = {
      metadata: metadataFor(Buffer.from('archive')),
      archivePath: '/tmp/final-junqi-dingtalk.tgz',
      archiveSize: 7,
    };
    const docker = new FakeDingTalkDockerRuntime({
      runId,
      archivePath: bundle.archivePath,
      token,
    });
    const result = await runDingTalkGatewaySmoke({
      runId,
      bundle,
      dockerRuntime: docker,
      evidenceRoot,
      tokenFactory: () => token,
      gatewayPortFactory: () => 53_121,
      readinessProbe: async () => ({ attempts: 1, durationMs: 1, health: { ok: true } }),
    });
    assert.equal(result.evidence.status, 'PASSED');
    assert.deepEqual(Object.values(result.evidence.verified), [true, true, true, true, true, true, true]);
    assert.deepEqual(Object.values(result.evidence.notVerified), Array(9).fill(true));
    assert.equal(result.evidence.isolation.remoteDwsStarted, false);
    assert.equal(result.evidence.isolation.runtimeNetwork.internal, true);
    assert.notEqual(
      result.evidence.snapshot.beforeRestart.runtimeGeneration,
      result.evidence.snapshot.afterRestart.runtimeGeneration,
    );
    assert.ok(docker.bootstrapCalls.some((call) => call.archiveDestination === DINGTALK_ARCHIVE_DESTINATION));
    assert.ok(docker.events.includes('restart-gateway'));
    assert.deepEqual(docker.scopedGatewayCalls.map((call) => call.scopes), [
      ['operator.read'],
      ['operator.write'],
      ['operator.read'],
    ]);
    assert.ok(docker.removedContainers.some((name) => name.endsWith('-gateway')));
    assert.ok(docker.removedNetworks.some((name) => name.endsWith('-runtime')));
    assert.equal(docker.removedVolumes.length, 1);
    const evidenceText = await readFile(result.evidencePath, 'utf8');
    const gatewayLog = await readFile(result.gatewayLogPath, 'utf8');
    assert.equal(evidenceText.includes(token), false);
    assert.equal(gatewayLog.includes(token), false);
    assert.match(gatewayLog, /\[REDACTED\]/);
  });

  test('writes redacted failure evidence and cleans resources', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-dingtalk-gateway-failure-');
    const runId = '20260909-failure01';
    const token = 'b'.repeat(64);
    const bundle = {
      metadata: metadataFor(Buffer.from('archive')),
      archivePath: '/tmp/final-junqi-dingtalk.tgz',
      archiveSize: 7,
    };
    const docker = new FakeDingTalkDockerRuntime({
      runId,
      archivePath: bundle.archivePath,
      token,
      failAtSnapshot: true,
    });
    await assert.rejects(runDingTalkGatewaySmoke({
      runId,
      bundle,
      dockerRuntime: docker,
      evidenceRoot,
      tokenFactory: () => token,
      gatewayPortFactory: () => 53_122,
      readinessProbe: async () => ({ attempts: 1, durationMs: 1, health: { ok: true } }),
      snapshotProbe: async (runtime, containerName, gatewayPort) => assertScopedReadSuccess(
        await runtime.gatewayCallWithScopes(
          containerName,
          gatewayPort,
          'junqi.dingtalk.events.snapshot',
          {},
          ['operator.read'],
        ),
      ),
    }), StructuralSmokeFailure);
    const evidenceText = await readFile(path.join(evidenceRoot, runId, 'evidence.json'), 'utf8');
    const evidence = JSON.parse(evidenceText);
    assert.equal(evidence.status, 'FAILED');
    assert.equal(evidenceText.includes(token), false);
    assert.match(evidence.failure.message, /\[REDACTED\]/);
    assert.ok(docker.removedContainers.some((name) => name.endsWith('-gateway')));
    assert.equal(docker.removedVolumes.length, 1);
  });

  test('proves the effective Gateway plugin DWS fixture read chain without retaining payload', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-dingtalk-gateway-chain-');
    const fixtureRoot = await temporaryDirectory('junqi-dingtalk-dws-fixture-');
    const fixturePath = path.join(fixtureRoot, 'dws-fixture.js');
    await writeFile(fixturePath, 'process.exitCode = 0;\n');
    const runId = '20260909-chain01';
    const token = 'f'.repeat(64);
    const bundle = {
      metadata: metadataFor(Buffer.from('archive')),
      archivePath: '/tmp/final-junqi-dingtalk.tgz',
      archiveSize: 7,
    };
    const docker = new FakeDingTalkDockerRuntime({
      runId,
      archivePath: bundle.archivePath,
      token,
    });
    const result = await runDingTalkGatewaySmoke({
      runId,
      bundle,
      dockerRuntime: docker,
      evidenceRoot,
      tokenFactory: () => token,
      gatewayPortFactory: () => 53_123,
      readinessProbe: async () => ({ attempts: 1, durationMs: 1, health: { ok: true } }),
      fixturePluginChain: true,
      dwsFixturePath: fixturePath,
    });
    assert.equal(result.evidence.status, 'PASSED');
    assert.deepEqual(Object.values(result.evidence.verified), Array(11).fill(true));
    assert.equal(result.evidence.notVerified.realDwsRuntime, true);
    assert.equal(result.evidence.isolation.deterministicFixtureMounted, true);
    assert.equal(result.evidence.fixtureChain.businessPayloadRetained, false);
    assert.equal(result.evidence.fixtureChain.profileRetained, false);
    const evidenceText = await readFile(result.evidencePath, 'utf8');
    assert.equal(evidenceText.includes('smoke:test-user'), false);
    assert.equal(evidenceText.includes('test-user'), false);
    assert.deepEqual(docker.scopedGatewayCalls.map((call) => call.method), [
      'junqi.dingtalk.events.snapshot',
      'junqi.dingtalk.events.snapshot',
      'sessions.create',
      'tools.effective',
      'tools.invoke',
      'junqi.dingtalk.events.snapshot',
    ]);
    assert.deepEqual(docker.scopedGatewayCalls.map((call) => call.scopes), [
      ['operator.read'],
      ['operator.write'],
      ['operator.write'],
      ['operator.read'],
      ['operator.write'],
      ['operator.read'],
    ]);
  });

  test('fails closed before invocation when the effective session tool is missing', async () => {
    const evidenceRoot = await temporaryDirectory('junqi-dingtalk-gateway-chain-failure-');
    const fixtureRoot = await temporaryDirectory('junqi-dingtalk-dws-fixture-failure-');
    const fixturePath = path.join(fixtureRoot, 'dws-fixture.js');
    await writeFile(fixturePath, 'process.exitCode = 0;\n');
    const runId = '20260909-chainfail';
    const token = '1'.repeat(64);
    const bundle = {
      metadata: metadataFor(Buffer.from('archive')),
      archivePath: '/tmp/final-junqi-dingtalk.tgz',
      archiveSize: 7,
    };
    const docker = new FakeDingTalkDockerRuntime({
      runId,
      archivePath: bundle.archivePath,
      token,
      failAtEffectiveTools: true,
    });
    await assert.rejects(runDingTalkGatewaySmoke({
      runId,
      bundle,
      dockerRuntime: docker,
      evidenceRoot,
      tokenFactory: () => token,
      gatewayPortFactory: () => 53_124,
      readinessProbe: async () => ({ attempts: 1, durationMs: 1, health: { ok: true } }),
      fixturePluginChain: true,
      dwsFixturePath: fixturePath,
    }), StructuralSmokeFailure);
    assert.equal(docker.scopedGatewayCalls.some((call) => call.method === 'tools.invoke'), false);
    assert.ok(docker.removedContainers.some((name) => name.endsWith('-gateway')));
    assert.equal(docker.removedVolumes.length, 1);
  });
});
