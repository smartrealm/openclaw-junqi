import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  DINGTALK_TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE,
  parseDingTalkTargetGatewayReadonlyArguments,
  runDingTalkTargetGatewayReadonly,
  serializeDingTalkTargetGatewayReadonlyFailure,
} from './verify-dingtalk-target-gateway-readonly.mjs';

const temporaryDirectories = [];
const input = {
  agentId: 'main',
  sessionKey: 'agent:main:target-readonly',
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

function effectiveResult(scope, overrides = {}) {
  return {
    agentId: 'main',
    profile: 'full',
    groups: [{
      id: 'plugin',
      label: 'Plugins',
      source: 'plugin',
      tools: DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE[scope].map((contract) => ({
        id: contract.toolName,
        label: contract.toolName,
        description: contract.toolName,
        rawDescription: contract.toolName,
        source: 'plugin',
        pluginId: 'junqi-dingtalk',
        risk: 'low',
        tags: ['dingtalk', 'read'],
        ...(overrides[contract.toolName] ?? {}),
      })),
    }],
  };
}

function invocationResult(contract, payload = { count: 1 }, detailsOverrides = {}) {
  const details = {
    success: true,
    toolName: contract.toolName,
    dwsCanonicalPath: contract.canonicalPath,
    profileRef: 'corp:user',
    schemaDigest: 'b'.repeat(64),
    observedAt: '2026-09-09T13:00:00.000Z',
    data: {
      ok: true,
      outcome: 'success',
      data: payload,
    },
    ...detailsOverrides,
  };
  return {
    ok: true,
    toolName: contract.toolName,
    source: 'plugin',
    output: {
      content: [{ type: 'text', text: JSON.stringify(details) }],
      details,
    },
  };
}

async function runCli(args, stdin, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('scripts/verify-dingtalk-target-gateway-readonly.mjs'),
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

test('target Gateway readonly scopes are fixed, unique and cumulative', () => {
  const core = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.core;
  const extended = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.extended;
  assert.equal(core.length, 5);
  assert.equal(extended.length, 12);
  assert.deepEqual(extended.slice(0, core.length), core);
  assert.equal(new Set(extended.map((contract) => contract.toolName)).size, 12);
  assert.equal(new Set(extended.map((contract) => contract.canonicalPath)).size, 12);
});

test('target Gateway readonly arguments require an explicit scope and acknowledgement', () => {
  const packageJsonPath = path.resolve('target-openclaw', 'package.json');
  assert.deepEqual(parseDingTalkTargetGatewayReadonlyArguments([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', packageJsonPath,
    '--scope', 'extended',
    '--acknowledge-target-readonly', DINGTALK_TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT,
  ]), {
    gatewayUrl: 'wss://gateway.example.test/',
    packageJsonPath,
    scope: 'extended',
  });
  assert.throws(
    () => parseDingTalkTargetGatewayReadonlyArguments([
      '--gateway-url', 'wss://gateway.example.test',
      '--openclaw-package', packageJsonPath,
      '--scope', 'all',
      '--acknowledge-target-readonly', DINGTALK_TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT,
    ]),
    (error) => error.code === 'TARGET_GATEWAY_READONLY_SCOPE_INVALID',
  );
});

test('target Gateway core matrix proves projection once and invokes five reads sequentially', async () => {
  const calls = [];
  const contracts = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.core;
  const byName = new Map(contracts.map((contract) => [contract.toolName, contract]));
  const result = await runDingTalkTargetGatewayReadonly({
    input,
    gatewayUrl: 'wss://gateway.example.test/',
    gatewayToken: 'target-gateway-secret',
    scope: 'core',
    async callGatewayFromCli(method, rpcOptions, params, extra) {
      calls.push({ method, rpcOptions, params, extra });
      if (method === 'tools.effective') return effectiveResult('core');
      return invocationResult(byName.get(params.name), { privateValue: params.name });
    },
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.checkedCount, 5);
  assert.equal(result.passedCount, 5);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(calls.map((call) => call.method), [
    'tools.effective',
    'tools.invoke',
    'tools.invoke',
    'tools.invoke',
    'tools.invoke',
    'tools.invoke',
  ]);
  assert.deepEqual(calls[0].extra.scopes, ['operator.read']);
  assert.equal(calls.slice(1).every((call) => (
    JSON.stringify(call.extra.scopes) === JSON.stringify(['operator.write'])
      && call.params.sessionKey === input.sessionKey
      && call.params.agentId === input.agentId
      && call.params.args.profile === input.profile
      && Object.keys(call.params.args.arguments).length === 0
  )), true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('target-gateway-secret'), false);
  assert.equal(serialized.includes(input.sessionKey), false);
  assert.equal(serialized.includes(input.profile), false);
  assert.equal(serialized.includes('privateValue'), false);
});

test('target Gateway extended matrix invokes all twelve reviewed reads', async () => {
  const contracts = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.extended;
  const byName = new Map(contracts.map((contract) => [contract.toolName, contract]));
  const invoked = [];
  const result = await runDingTalkTargetGatewayReadonly({
    input,
    gatewayUrl: 'wss://gateway.example.test/',
    gatewayToken: 'target-gateway-secret',
    scope: 'extended',
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult('extended');
      invoked.push(params.name);
      return invocationResult(byName.get(params.name));
    },
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.checkedCount, 12);
  assert.deepEqual(invoked, contracts.map((contract) => contract.toolName));
});

test('target Gateway readonly projection failure prevents every DWS invocation', async () => {
  const methods = [];
  await assert.rejects(
    runDingTalkTargetGatewayReadonly({
      input,
      gatewayUrl: 'wss://gateway.example.test/',
      gatewayToken: 'target-gateway-secret',
      scope: 'core',
      async callGatewayFromCli(method) {
        methods.push(method);
        return effectiveResult('core', {
          junqi_dingtalk_todo_overdue: { deniedBySession: true },
        });
      },
    }),
    (error) => error.code === 'TARGET_GATEWAY_DINGTALK_TOOL_DENIED',
  );
  assert.deepEqual(methods, ['tools.effective']);
});

test('target Gateway readonly matrix continues after a failed read and redacts remote details', async () => {
  const contracts = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.core;
  const byName = new Map(contracts.map((contract) => [contract.toolName, contract]));
  const secret = 'remote-private-error-and-payload';
  const invoked = [];
  const result = await runDingTalkTargetGatewayReadonly({
    input,
    gatewayUrl: 'wss://gateway.example.test/',
    gatewayToken: 'target-gateway-secret',
    scope: 'core',
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult('core');
      invoked.push(params.name);
      if (params.name === 'junqi_dingtalk_todo_overdue') {
        const error = new Error(secret);
        error.name = 'GatewayClientRequestError';
        error.gatewayCode = 'FORBIDDEN';
        error.details = { code: 'MISSING_SCOPE', payload: secret };
        throw error;
      }
      return invocationResult(byName.get(params.name));
    },
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.checkedCount, 5);
  assert.equal(result.passedCount, 4);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failures, [{
    toolName: 'junqi_dingtalk_todo_overdue',
    canonicalPath: 'todo.shortcut_overdue',
    code: 'GATEWAY_FORBIDDEN_MISSING_SCOPE',
  }]);
  assert.deepEqual(invoked, contracts.map((contract) => contract.toolName));
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('target Gateway readonly CLI removes the token before loading OpenClaw and keeps payloads out of evidence', async () => {
  const packageRoot = await temporaryDirectory('junqi-openclaw-readonly-cli-');
  await mkdir(path.join(packageRoot, 'dist', 'plugin-sdk'), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'openclaw',
    version: '2099.3.0',
    type: 'module',
    exports: {
      './plugin-sdk/gateway-runtime': {
        default: './dist/plugin-sdk/gateway-runtime.js',
      },
    },
  }));
  const contracts = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.core;
  const invocations = Object.fromEntries(contracts.map((contract) => [
    contract.toolName,
    invocationResult(contract, { privateTenantValue: contract.toolName }),
  ]));
  await writeFile(
    path.join(packageRoot, 'dist', 'plugin-sdk', 'gateway-runtime.js'),
    [
      `const effective = ${JSON.stringify(effectiveResult('core'))};`,
      `const invocations = ${JSON.stringify(invocations)};`,
      'if (process.env.OPENCLAW_GATEWAY_TOKEN !== undefined) throw new Error("token remained in the imported module environment");',
      'export async function callGatewayFromCli(method, options, params, extra) {',
      '  if (method === "tools.effective") return effective;',
      '  if (JSON.stringify(extra.scopes) !== JSON.stringify(["operator.write"])) throw new Error("unexpected scope");',
      '  return invocations[params.name];',
      '}',
      '',
    ].join('\n'),
  );
  const gatewayToken = 'target-gateway-readonly-process-secret';
  const result = await runCli([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', path.join(packageRoot, 'package.json'),
    '--scope', 'core',
    '--acknowledge-target-readonly', DINGTALK_TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT,
  ], JSON.stringify(input), {
    ...process.env,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, 'PASSED');
  assert.equal(evidence.openClawPackageVersion, '2099.3.0');
  assert.equal(evidence.checkedCount, 5);
  assert.equal(result.stdout.includes(gatewayToken), false);
  assert.equal(result.stdout.includes(input.sessionKey), false);
  assert.equal(result.stdout.includes(input.profile), false);
  assert.equal(result.stdout.includes('privateTenantValue'), false);
});

test('target Gateway readonly fatal failures serialize only stable codes', () => {
  const serialized = serializeDingTalkTargetGatewayReadonlyFailure(
    new Error('private transport message'),
  );
  assert.deepEqual(serialized, {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_READONLY_MATRIX',
    status: 'FAILED',
    code: 'TARGET_GATEWAY_READONLY_TOOL_FAILED',
  });
});
