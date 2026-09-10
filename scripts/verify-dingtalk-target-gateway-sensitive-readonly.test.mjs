import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS,
  parseDingTalkTargetGatewaySensitiveReadonlyArguments,
  parseDingTalkTargetGatewaySensitiveReadonlyInput,
  readDingTalkTargetGatewaySensitiveReadonlyInput,
  resolveDingTalkSensitiveVerifierRuntime,
  runDingTalkTargetGatewaySensitiveReadonly,
  serializeDingTalkTargetGatewaySensitiveReadonlyFailure,
} from './verify-dingtalk-target-gateway-sensitive-readonly.mjs';

const temporaryDirectories = [];
const schemaToolName = 'junqi_dingtalk_tool_schema';
const plans = DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS.map((contract, index) => ({
  ...contract,
  arguments: index === 9
    ? { file: { privateRequest: 'controlled-contract-request' } }
    : { id: `controlled-${index + 1}` },
  schemaArguments: index === 9 ? { file: '-' } : { id: `controlled-${index + 1}` },
}));
const input = {
  agentId: 'main',
  sessionKey: 'agent:main:target-sensitive',
  profile: 'corp:user',
  fixture: { privateFixture: 'controlled-sensitive-fixture' },
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

function effectiveResult() {
  return {
    agentId: 'main',
    profile: 'full',
    groups: [{
      id: 'plugin',
      label: 'Plugins',
      source: 'plugin',
      tools: [schemaToolName, ...plans.map((plan) => plan.toolName)].map((toolName) => ({
        id: toolName,
        label: toolName,
        description: toolName,
        rawDescription: toolName,
        source: 'plugin',
        pluginId: 'junqi-dingtalk',
        risk: 'low',
        tags: ['dingtalk', 'read'],
      })),
    }],
  };
}

function schemaInvocation(plan, digest = 'a'.repeat(64)) {
  const parameterName = plan.schemaArguments.file === '-' ? 'file' : 'id';
  const details = {
    success: true,
    toolName: plan.toolName,
    dwsCanonicalPath: plan.canonicalPath,
    schemaDigest: digest,
    effect: 'read',
    risk: 'low',
    confirmation: 'not_required',
    idempotency: 'idempotent',
    parameters: { [parameterName]: { type: 'string', required: true } },
    constraints: {},
  };
  return {
    ok: true,
    toolName: schemaToolName,
    source: 'plugin',
    output: {
      content: [{ type: 'text', text: JSON.stringify(details) }],
      details,
    },
  };
}

function businessInvocation(plan, digest = 'a'.repeat(64)) {
  const details = {
    success: true,
    toolName: plan.toolName,
    dwsCanonicalPath: plan.canonicalPath,
    profileRef: input.profile,
    schemaDigest: digest,
    observedAt: '2026-09-09T14:00:00.000Z',
    data: {
      ok: true,
      outcome: 'success',
      data: { privateBusinessPayload: plan.toolName },
    },
  };
  return {
    ok: true,
    toolName: plan.toolName,
    source: 'plugin',
    output: {
      content: [{ type: 'text', text: JSON.stringify(details) }],
      details,
    },
  };
}

function runOptions(overrides = {}) {
  const byName = new Map(plans.map((plan) => [plan.toolName, plan]));
  return {
    input,
    gatewayUrl: 'wss://gateway.example.test/',
    gatewayToken: 'target-sensitive-token',
    schemaToolName,
    buildInvocations: () => plans,
    buildSchemaValidatedArguments() {},
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      const plan = byName.get(params.name === schemaToolName ? params.args.toolName : params.name);
      return params.name === schemaToolName ? schemaInvocation(plan) : businessInvocation(plan);
    },
    ...overrides,
  };
}

async function runCli(args, stdin, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('scripts/verify-dingtalk-target-gateway-sensitive-readonly.mjs'),
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

async function runNode(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  });
}

test('target Gateway sensitive-read contracts match the shared plugin plan', async () => {
  const fixture = {
    aitable: { query: 'controlled', baseId: 'base', tableId: 'table', recordId: 'record' },
    contract: {
      projectId: 1,
      projectCode: 'project',
      subjectId: 2,
      subjectName: 'subject',
      analysisRequest: { fileInfo: { fileId: 'file' } },
      reviewTaskId: 'review',
      reviewType: 'AI_REVIEW',
    },
    recruit: { jobId: 'job' },
    goal: {
      templateKeyword: 'template',
      ruleKeyword: 'rule',
      templateId: 'template-id',
      submitState: 'ON_TIME',
    },
  };
  const moduleUrl = pathToFileURL(path.resolve(
    'packages/junqi-dingtalk/src/target-sensitive-readonly-preflight.ts',
  )).href;
  const source = [
    `import { buildDingTalkTargetSensitiveToolInvocations, parseDingTalkTargetSensitiveReadonlyFixture } from ${JSON.stringify(moduleUrl)};`,
    `const fixture = parseDingTalkTargetSensitiveReadonlyFixture(${JSON.stringify(fixture)});`,
    'const contracts = buildDingTalkTargetSensitiveToolInvocations(fixture).map(({ toolName, canonicalPath }) => ({ toolName, canonicalPath }));',
    'console.log(JSON.stringify(contracts));',
  ].join('\n');
  const result = await runNode(['--import', 'tsx', '--input-type=module', '--eval', source]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout),
    DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS,
  );
});

test('target Gateway sensitive-read arguments and input are explicit and bounded', async () => {
  const openclawPackage = path.resolve('target-openclaw', 'package.json');
  const dingtalkPackage = path.resolve('target-dingtalk', 'package.json');
  assert.deepEqual(parseDingTalkTargetGatewaySensitiveReadonlyArguments([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', openclawPackage,
    '--dingtalk-package', dingtalkPackage,
    '--acknowledge-target-sensitive-readonly', DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_ACKNOWLEDGEMENT,
  ]), {
    gatewayUrl: 'wss://gateway.example.test/',
    packageJsonPath: openclawPackage,
    dingtalkPackageJsonPath: dingtalkPackage,
  });
  assert.throws(
    () => parseDingTalkTargetGatewaySensitiveReadonlyArguments([
      '--gateway-url', 'wss://gateway.example.test',
      '--openclaw-package', openclawPackage,
      '--dingtalk-package', dingtalkPackage,
      '--acknowledge-target-sensitive-readonly', 'invalid',
    ]),
    (error) => error.code === 'TARGET_GATEWAY_SENSITIVE_ACKNOWLEDGEMENT_INVALID',
  );
  const document = { ...input, extra: true };
  assert.throws(
    () => parseDingTalkTargetGatewaySensitiveReadonlyInput(document, (value) => value),
    (error) => error.code === 'TARGET_GATEWAY_SENSITIVE_INPUT_INVALID',
  );
  await assert.rejects(
    readDingTalkTargetGatewaySensitiveReadonlyInput(Readable.from(['x'.repeat(1_048_577)])),
    (error) => error.code === 'TARGET_GATEWAY_SENSITIVE_INPUT_TOO_LARGE',
  );
});

test('target Gateway sensitive-read preflights all schemas before seventeen business reads', async () => {
  const calls = [];
  const result = await runDingTalkTargetGatewaySensitiveReadonly(runOptions({
    async callGatewayFromCli(method, rpcOptions, params, extra) {
      calls.push({ method, rpcOptions, params, extra });
      if (method === 'tools.effective') return effectiveResult();
      const plan = plans.find((entry) => (
        entry.toolName === (params.name === schemaToolName ? params.args.toolName : params.name)
      ));
      return params.name === schemaToolName ? schemaInvocation(plan) : businessInvocation(plan);
    },
  }));
  assert.equal(result.status, 'PASSED');
  assert.equal(result.checkedCount, 17);
  assert.equal(result.schemaVerifiedCount, 17);
  assert.equal(result.argumentValidatedCount, 17);
  assert.equal(result.readAttemptedCount, 17);
  assert.equal(result.passedCount, 17);
  assert.deepEqual(calls.map((call) => call.method), [
    'tools.effective',
    ...Array(34).fill('tools.invoke'),
  ]);
  assert.equal(calls.slice(1, 18).every((call) => call.params.name === schemaToolName), true);
  assert.deepEqual(calls[18 + 9].params.args.arguments, {
    file: { privateRequest: 'controlled-contract-request' },
  });
  assert.equal(calls[18 + 9].params.args.arguments.file === '-', false);
  assert.equal(calls[0].extra.scopes[0], 'operator.read');
  assert.equal(calls.slice(1).every((call) => call.extra.scopes[0] === 'operator.write'), true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(input.fixture.privateFixture), false);
  assert.equal(serialized.includes('privateBusinessPayload'), false);
  assert.equal(serialized.includes(input.profile), false);
  assert.equal(serialized.includes(input.sessionKey), false);
});

test('target Gateway sensitive-read Schema failure completes preflight and performs zero business reads', async () => {
  const invokedNames = [];
  const byName = new Map(plans.map((plan) => [plan.toolName, plan]));
  const result = await runDingTalkTargetGatewaySensitiveReadonly(runOptions({
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      invokedNames.push(params.name);
      const plan = byName.get(params.args.toolName);
      if (params.args.toolName === plans[4].toolName) {
        const error = new Error('private schema failure');
        error.name = 'GatewayClientRequestError';
        error.gatewayCode = 'FORBIDDEN';
        error.details = { code: 'MISSING_SCOPE', privateValue: 'discarded' };
        throw error;
      }
      return schemaInvocation(plan);
    },
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.schemaVerifiedCount, 16);
  assert.equal(result.argumentValidatedCount, 16);
  assert.equal(result.readAttemptedCount, 0);
  assert.equal(invokedNames.length, 17);
  assert.equal(invokedNames.every((name) => name === schemaToolName), true);
  assert.deepEqual(result.failures, [{
    toolName: plans[4].toolName,
    canonicalPath: plans[4].canonicalPath,
    stage: 'schema',
    code: 'GATEWAY_FORBIDDEN_MISSING_SCOPE',
  }]);
  assert.equal(JSON.stringify(result).includes('private schema failure'), false);
});

test('target Gateway sensitive-read argument drift performs zero business reads', async () => {
  let validationCount = 0;
  let businessReadCount = 0;
  const result = await runDingTalkTargetGatewaySensitiveReadonly(runOptions({
    buildSchemaValidatedArguments() {
      validationCount += 1;
      if (validationCount === 7) throw new Error('private argument drift');
    },
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      if (params.name !== schemaToolName) {
        businessReadCount += 1;
        return businessInvocation(plans.find((plan) => plan.toolName === params.name));
      }
      return schemaInvocation(plans.find((plan) => plan.toolName === params.args.toolName));
    },
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.schemaVerifiedCount, 17);
  assert.equal(result.argumentValidatedCount, 16);
  assert.equal(result.readAttemptedCount, 0);
  assert.equal(businessReadCount, 0);
  assert.equal(result.failures[0].stage, 'arguments');
  assert.equal(JSON.stringify(result).includes('private argument drift'), false);
});

test('target Gateway sensitive-read continues after read failure and rejects Schema digest drift', async () => {
  const readNames = [];
  const result = await runDingTalkTargetGatewaySensitiveReadonly(runOptions({
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      const plan = plans.find((entry) => (
        entry.toolName === (params.name === schemaToolName ? params.args.toolName : params.name)
      ));
      if (params.name === schemaToolName) return schemaInvocation(plan);
      readNames.push(params.name);
      if (params.name === plans[2].toolName) throw new Error('private read failure');
      return businessInvocation(plan, params.name === plans[8].toolName ? 'b'.repeat(64) : 'a'.repeat(64));
    },
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.readAttemptedCount, 17);
  assert.equal(result.passedCount, 15);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(readNames, plans.map((plan) => plan.toolName));
  assert.deepEqual(result.failures.map((failure) => ({
    toolName: failure.toolName,
    stage: failure.stage,
    code: failure.code,
  })), [
    { toolName: plans[2].toolName, stage: 'read', code: 'TARGET_GATEWAY_READONLY_TOOL_FAILED' },
    { toolName: plans[8].toolName, stage: 'read', code: 'TARGET_GATEWAY_SENSITIVE_SCHEMA_CHANGED' },
  ]);
  assert.equal(JSON.stringify(result).includes('private read failure'), false);
});

test('DingTalk sensitive verifier runtime stays inside the explicit package root', async () => {
  const packageRoot = await temporaryDirectory('junqi-dingtalk-sensitive-runtime-');
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@junqi/openclaw-dingtalk-business',
    version: '9.9.9',
    type: 'module',
  }));
  await writeFile(path.join(packageRoot, 'dist', 'target-sensitive-readonly-preflight.js'), [
    'export function parseDingTalkTargetSensitiveReadonlyFixture(value) { return value; }',
    'export function buildDingTalkTargetSensitiveToolInvocations() { return []; }',
  ].join('\n'));
  await writeFile(path.join(packageRoot, 'dist', 'schema-contract.js'), [
    'export function buildSchemaValidatedArguments() { return []; }',
  ].join('\n'));
  await writeFile(path.join(packageRoot, 'dist', 'tool-specs.js'), [
    'export const TOOL_SCHEMA_TOOL_NAME = "junqi_dingtalk_tool_schema";',
  ].join('\n'));
  const runtime = await resolveDingTalkSensitiveVerifierRuntime(
    path.join(packageRoot, 'package.json'),
  );
  assert.equal(runtime.packageVersion, '9.9.9');
  assert.equal(runtime.schemaToolName, schemaToolName);
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'foreign-package',
    version: '9.9.9',
    type: 'module',
  }));
  await assert.rejects(
    resolveDingTalkSensitiveVerifierRuntime(path.join(packageRoot, 'package.json')),
    (error) => error.code === 'DINGTALK_PACKAGE_INVALID',
  );
});

test('target Gateway sensitive-read CLI deletes the token before imports and drops fixture payload', async () => {
  const openclawRoot = await temporaryDirectory('junqi-openclaw-sensitive-cli-');
  const dingtalkRoot = await temporaryDirectory('junqi-dingtalk-sensitive-cli-');
  await mkdir(path.join(openclawRoot, 'dist', 'plugin-sdk'), { recursive: true });
  await mkdir(path.join(dingtalkRoot, 'dist'), { recursive: true });
  await writeFile(path.join(openclawRoot, 'package.json'), JSON.stringify({
    name: 'openclaw',
    version: '2099.4.0',
    type: 'module',
    exports: {
      './plugin-sdk/gateway-runtime': {
        default: './dist/plugin-sdk/gateway-runtime.js',
      },
    },
  }));
  await writeFile(path.join(dingtalkRoot, 'package.json'), JSON.stringify({
    name: '@junqi/openclaw-dingtalk-business',
    version: '9.9.9',
    type: 'module',
  }));
  const serializedPlans = JSON.stringify(plans);
  await writeFile(path.join(dingtalkRoot, 'dist', 'target-sensitive-readonly-preflight.js'), [
    'if (process.env.OPENCLAW_GATEWAY_TOKEN !== undefined) throw new Error("token remained before DingTalk import");',
    'export function parseDingTalkTargetSensitiveReadonlyFixture(value) { return value; }',
    `const plans = ${serializedPlans};`,
    'export function buildDingTalkTargetSensitiveToolInvocations() { return plans; }',
  ].join('\n'));
  await writeFile(path.join(dingtalkRoot, 'dist', 'schema-contract.js'), [
    'if (process.env.OPENCLAW_GATEWAY_TOKEN !== undefined) throw new Error("token remained before schema import");',
    'export function buildSchemaValidatedArguments() { return []; }',
  ].join('\n'));
  await writeFile(path.join(dingtalkRoot, 'dist', 'tool-specs.js'), [
    'if (process.env.OPENCLAW_GATEWAY_TOKEN !== undefined) throw new Error("token remained before specs import");',
    `export const TOOL_SCHEMA_TOOL_NAME = ${JSON.stringify(schemaToolName)};`,
  ].join('\n'));
  await writeFile(path.join(openclawRoot, 'dist', 'plugin-sdk', 'gateway-runtime.js'), [
    'if (process.env.OPENCLAW_GATEWAY_TOKEN !== undefined) throw new Error("token remained before OpenClaw import");',
    `const effective = ${JSON.stringify(effectiveResult())};`,
    `const plans = ${serializedPlans};`,
    `const schemaToolName = ${JSON.stringify(schemaToolName)};`,
    `const input = { profile: ${JSON.stringify(input.profile)} };`,
    `const schemaInvocation = ${schemaInvocation.toString()};`,
    `const businessInvocation = ${businessInvocation.toString()};`,
    'export async function callGatewayFromCli(method, _options, params) {',
    '  if (method === "tools.effective") return effective;',
    '  const plan = plans.find((entry) => entry.toolName === (params.name === schemaToolName ? params.args.toolName : params.name));',
    '  return params.name === schemaToolName ? schemaInvocation(plan) : businessInvocation({ ...plan }, "a".repeat(64));',
    '}',
  ].join('\n'));
  const gatewayToken = 'target-sensitive-process-token';
  const privateFixture = 'target-sensitive-private-fixture';
  const result = await runCli([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', path.join(openclawRoot, 'package.json'),
    '--dingtalk-package', path.join(dingtalkRoot, 'package.json'),
    '--acknowledge-target-sensitive-readonly', DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_ACKNOWLEDGEMENT,
  ], JSON.stringify({
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    profile: input.profile,
    fixture: { privateFixture },
  }), {
    ...process.env,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  });
  assert.equal(result.code, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, 'PASSED');
  assert.equal(evidence.openClawPackageVersion, '2099.4.0');
  assert.equal(evidence.dingtalkPackageVersion, '9.9.9');
  for (const privateValue of [
    gatewayToken,
    privateFixture,
    input.sessionKey,
    input.profile,
    'privateBusinessPayload',
    'controlled-contract-request',
  ]) {
    assert.equal(result.stdout.includes(privateValue), false);
    assert.equal(result.stderr.includes(privateValue), false);
  }
});

test('target Gateway sensitive-read fatal failure keeps only a stable code', () => {
  const failure = serializeDingTalkTargetGatewaySensitiveReadonlyFailure(
    new Error('private fatal failure'),
  );
  assert.deepEqual(failure, {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_17',
    status: 'FAILED',
    code: 'TARGET_GATEWAY_READONLY_TOOL_FAILED',
  });
  assert.equal(JSON.stringify(failure).includes('private fatal failure'), false);
});
