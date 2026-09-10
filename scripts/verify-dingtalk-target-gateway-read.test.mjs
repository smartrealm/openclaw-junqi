import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, test } from 'node:test';

import {
  DINGTALK_TARGET_GATEWAY_READ_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_GATEWAY_READ_INPUT_LIMIT,
  DingTalkTargetGatewayReadFailure,
  assertDingTalkTargetEffectiveReadTool,
  assertDingTalkTargetReadInvocation,
  parseDingTalkTargetGatewayReadArguments,
  parseDingTalkTargetGatewayReadInput,
  readDingTalkTargetGatewayReadInput,
  resolveOpenClawGatewayRuntime,
  runDingTalkTargetGatewayRead,
  serializeDingTalkTargetGatewayReadFailure,
} from './verify-dingtalk-target-gateway-read.mjs';

const temporaryDirectories = [];
const input = {
  agentId: 'main',
  sessionKey: 'agent:main:target-smoke',
  profile: 'corp:user',
};

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

async function runCli(args, stdin, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('scripts/verify-dingtalk-target-gateway-read.mjs'),
      ...args,
    ], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
    child.stdin.end(stdin);
  });
}

function effectiveResult(overrides = {}) {
  return {
    agentId: 'main',
    profile: 'full',
    groups: [{
      id: 'plugin',
      label: 'Plugins',
      source: 'plugin',
      tools: [{
        id: 'junqi_dingtalk_contact_me',
        label: 'Current user',
        description: 'Read current DingTalk user',
        rawDescription: 'Read current DingTalk user',
        source: 'plugin',
        pluginId: 'junqi-dingtalk',
        risk: 'low',
        tags: ['dingtalk', 'contact', 'read'],
        ...overrides,
      }],
    }],
  };
}

function invocationResult(overrides = {}) {
  const details = {
    success: true,
    toolName: 'junqi_dingtalk_contact_me',
    dwsCanonicalPath: 'contact.get_current_user_profile',
    profileRef: 'corp:user',
    schemaDigest: 'a'.repeat(64),
    observedAt: '2026-09-09T12:00:00.000Z',
    data: {
      ok: true,
      outcome: 'success',
      data: { name: 'Target user' },
    },
    ...overrides,
  };
  return {
    ok: true,
    toolName: 'junqi_dingtalk_contact_me',
    source: 'plugin',
    output: {
      content: [{ type: 'text', text: JSON.stringify(details) }],
      details,
    },
  };
}

test('target Gateway read arguments require explicit safe transport inputs and acknowledgement', () => {
  const packageJsonPath = path.resolve('target-openclaw', 'package.json');
  assert.deepEqual(parseDingTalkTargetGatewayReadArguments([
    '--gateway-url', 'wss://gateway.example.test:443',
    '--openclaw-package', packageJsonPath,
    '--acknowledge-target-read', DINGTALK_TARGET_GATEWAY_READ_ACKNOWLEDGEMENT,
  ]), {
    gatewayUrl: 'wss://gateway.example.test/',
    packageJsonPath,
  });
  assert.throws(
    () => parseDingTalkTargetGatewayReadArguments([
      '--gateway-url', 'wss://secret@gateway.example.test/?token=secret',
      '--openclaw-package', packageJsonPath,
      '--acknowledge-target-read', DINGTALK_TARGET_GATEWAY_READ_ACKNOWLEDGEMENT,
    ]),
    (error) => error.code === 'TARGET_GATEWAY_URL_INVALID',
  );
  assert.throws(
    () => parseDingTalkTargetGatewayReadArguments([
      '--gateway-url', 'wss://gateway.example.test',
      '--openclaw-package', packageJsonPath,
      '--acknowledge-target-read', 'wrong',
    ]),
    (error) => error.code === 'TARGET_GATEWAY_READ_ACKNOWLEDGEMENT_INVALID',
  );
});

test('target Gateway read input is closed, bounded and normalized', () => {
  assert.deepEqual(parseDingTalkTargetGatewayReadInput({
    agentId: ' main ',
    sessionKey: ' agent:main:target-smoke ',
    profile: ' corp:user ',
  }), input);
  assert.throws(
    () => parseDingTalkTargetGatewayReadInput({ ...input, payload: {} }),
    (error) => error.code === 'TARGET_GATEWAY_READ_INPUT_INVALID',
  );
  assert.throws(
    () => parseDingTalkTargetGatewayReadInput({ ...input, profile: 'not-a-profile' }),
    (error) => error.code === 'TARGET_GATEWAY_READ_INPUT_INVALID',
  );
});

test('target Gateway read stdin rejects invalid JSON and oversized content', async () => {
  await assert.rejects(
    readDingTalkTargetGatewayReadInput(Readable.from(['not-json'])),
    (error) => error.code === 'TARGET_GATEWAY_READ_INPUT_INVALID',
  );
  await assert.rejects(
    readDingTalkTargetGatewayReadInput(Readable.from(['x'.repeat(DINGTALK_TARGET_GATEWAY_READ_INPUT_LIMIT + 1)])),
    (error) => error.code === 'TARGET_GATEWAY_READ_INPUT_TOO_LARGE',
  );
});

test('target Gateway read resolves only the official package-relative runtime export', async () => {
  const packageRoot = await temporaryDirectory('junqi-openclaw-runtime-');
  await mkdir(path.join(packageRoot, 'dist', 'plugin-sdk'), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'openclaw',
    version: '2099.1.0',
    type: 'module',
    exports: {
      './plugin-sdk/gateway-runtime': {
        default: './dist/plugin-sdk/gateway-runtime.js',
      },
    },
  }));
  await writeFile(
    path.join(packageRoot, 'dist', 'plugin-sdk', 'gateway-runtime.js'),
    'export async function callGatewayFromCli() { return { ok: true }; }\n',
  );
  const runtime = await resolveOpenClawGatewayRuntime(path.join(packageRoot, 'package.json'));
  assert.equal(runtime.packageVersion, '2099.1.0');
  assert.equal(typeof runtime.callGatewayFromCli, 'function');
});

test('target Gateway read rejects package exports outside the explicit OpenClaw root', async () => {
  const parent = await temporaryDirectory('junqi-openclaw-runtime-invalid-');
  const packageRoot = path.join(parent, 'openclaw');
  await mkdir(packageRoot);
  await writeFile(path.join(parent, 'outside.js'), 'export const callGatewayFromCli = async () => ({});\n');
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'openclaw',
    exports: {
      './plugin-sdk/gateway-runtime': {
        default: '../outside.js',
      },
    },
  }));
  await assert.rejects(
    resolveOpenClawGatewayRuntime(path.join(packageRoot, 'package.json')),
    (error) => error.code === 'OPENCLAW_GATEWAY_RUNTIME_EXPORT_INVALID',
  );
});

test('target Gateway effective inventory proves the exact plugin owner and Session visibility', () => {
  assert.deepEqual(assertDingTalkTargetEffectiveReadTool(effectiveResult(), 'main'), {
    toolName: 'junqi_dingtalk_contact_me',
    pluginId: 'junqi-dingtalk',
  });
  assert.throws(
    () => assertDingTalkTargetEffectiveReadTool(effectiveResult({ deniedBySession: true }), 'main'),
    (error) => error.code === 'TARGET_GATEWAY_DINGTALK_TOOL_DENIED',
  );
  assert.throws(
    () => assertDingTalkTargetEffectiveReadTool(effectiveResult({ pluginId: 'other-plugin' }), 'main'),
    (error) => error.code === 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID',
  );
});

test('target Gateway invocation proves the DWS envelope without returning business data', () => {
  assert.deepEqual(assertDingTalkTargetReadInvocation(invocationResult(), 'corp:user'), {
    schemaDigest: 'a'.repeat(64),
    observedAt: '2026-09-09T12:00:00.000Z',
  });
  assert.throws(
    () => assertDingTalkTargetReadInvocation(invocationResult({ profileRef: 'corp:other' }), 'corp:user'),
    (error) => error.code === 'TARGET_GATEWAY_PROFILE_MISMATCH',
  );
  assert.throws(
    () => assertDingTalkTargetReadInvocation(invocationResult({ data: { ok: false } }), 'corp:user'),
    (error) => error.code === 'TARGET_GATEWAY_DWS_RESULT_INVALID',
  );
});

test('target Gateway read uses the official scoped methods and emits only redacted evidence', async () => {
  const calls = [];
  const result = await runDingTalkTargetGatewayRead({
    input,
    gatewayUrl: 'wss://gateway.example.test/',
    gatewayToken: 'target-gateway-secret',
    async callGatewayFromCli(method, rpcOptions, params, extra) {
      calls.push({ method, rpcOptions, params, extra });
      return method === 'tools.effective' ? effectiveResult() : invocationResult();
    },
  });
  assert.deepEqual(calls, [
    {
      method: 'tools.effective',
      rpcOptions: {
        url: 'wss://gateway.example.test/',
        token: 'target-gateway-secret',
        timeout: '30000',
        json: true,
      },
      params: {
        sessionKey: 'agent:main:target-smoke',
        agentId: 'main',
      },
      extra: {
        deviceIdentity: null,
        progress: false,
        scopes: ['operator.read'],
        sharedStateMode: 'read-only',
      },
    },
    {
      method: 'tools.invoke',
      rpcOptions: {
        url: 'wss://gateway.example.test/',
        token: 'target-gateway-secret',
        timeout: '30000',
        json: true,
      },
      params: {
        name: 'junqi_dingtalk_contact_me',
        args: { profile: 'corp:user', arguments: {} },
        sessionKey: 'agent:main:target-smoke',
        agentId: 'main',
      },
      extra: {
        deviceIdentity: null,
        progress: false,
        scopes: ['operator.write'],
        sharedStateMode: 'read-only',
      },
    },
  ]);
  assert.equal(JSON.stringify(result).includes('target-gateway-secret'), false);
  assert.equal(JSON.stringify(result).includes('agent:main:target-smoke'), false);
  assert.equal(JSON.stringify(result).includes('corp:user'), false);
  assert.equal(JSON.stringify(result).includes('Target user'), false);
  assert.deepEqual(result.retained, {
    gatewayToken: false,
    sessionKey: false,
    profileRef: false,
    businessPayload: false,
  });
});

test('target Gateway read CLI removes the token before importing OpenClaw and prints redacted evidence', async () => {
  const packageRoot = await temporaryDirectory('junqi-openclaw-runtime-cli-');
  await mkdir(path.join(packageRoot, 'dist', 'plugin-sdk'), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'openclaw',
    version: '2099.2.0',
    type: 'module',
    exports: {
      './plugin-sdk/gateway-runtime': {
        default: './dist/plugin-sdk/gateway-runtime.js',
      },
    },
  }));
  await writeFile(
    path.join(packageRoot, 'dist', 'plugin-sdk', 'gateway-runtime.js'),
    [
      `const effective = ${JSON.stringify(effectiveResult())};`,
      `const invocation = ${JSON.stringify(invocationResult())};`,
      'if (process.env.OPENCLAW_GATEWAY_TOKEN !== undefined) throw new Error("token remained in the imported module environment");',
      'export async function callGatewayFromCli(method) {',
      '  return method === "tools.effective" ? effective : invocation;',
      '}',
      '',
    ].join('\n'),
  );
  const gatewayToken = 'target-gateway-process-secret';
  const result = await runCli([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', path.join(packageRoot, 'package.json'),
    '--acknowledge-target-read', DINGTALK_TARGET_GATEWAY_READ_ACKNOWLEDGEMENT,
  ], JSON.stringify(input), {
    ...process.env,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, 'PASSED');
  assert.equal(evidence.openClawPackageVersion, '2099.2.0');
  assert.equal(result.stdout.includes(gatewayToken), false);
  assert.equal(result.stdout.includes(input.sessionKey), false);
  assert.equal(result.stdout.includes(input.profile), false);
  assert.equal(result.stdout.includes('Target user'), false);
});

test('target Gateway read does not invoke DWS when the Session projection fails', async () => {
  const methods = [];
  await assert.rejects(
    runDingTalkTargetGatewayRead({
      input,
      gatewayUrl: 'wss://gateway.example.test/',
      gatewayToken: 'target-gateway-secret',
      async callGatewayFromCli(method) {
        methods.push(method);
        return effectiveResult({ deniedBySession: true });
      },
    }),
    (error) => error.code === 'TARGET_GATEWAY_DINGTALK_TOOL_DENIED',
  );
  assert.deepEqual(methods, ['tools.effective']);
});

test('target Gateway read failures serialize only a stable code', () => {
  const secret = 'sensitive-profile-and-payload';
  const serialized = serializeDingTalkTargetGatewayReadFailure(
    new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_TOOL_INVOKE_FAILED', secret),
  );
  assert.deepEqual(serialized, {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_CURRENT_USER_READ',
    status: 'FAILED',
    code: 'TARGET_GATEWAY_TOOL_INVOKE_FAILED',
  });
  assert.equal(JSON.stringify(serialized).includes(secret), false);
});
