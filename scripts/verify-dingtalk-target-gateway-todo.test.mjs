import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  DINGTALK_TARGET_GATEWAY_TODO_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS,
  DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS,
  parseDingTalkTargetGatewayTodoArguments,
  parseDingTalkTargetGatewayTodoInput,
  readDingTalkTargetGatewayTodoInput,
  runDingTalkTargetGatewayTodo,
  serializeDingTalkTargetGatewayTodoFailure,
} from './verify-dingtalk-target-gateway-todo.mjs';

const temporaryDirectories = [];
const schemaToolName = 'junqi_dingtalk_tool_schema';
const input = {
  agentId: 'main',
  sessionKey: 'agent:main:target-todo',
  profile: 'corp:user',
  fixture: {
    executor: 'user',
    title: '受控验收待办-唯一标识',
    updatedTitle: '受控验收待办-唯一标识-已更新',
  },
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

function effectiveResult(options = {}) {
  const tools = [{ toolName: schemaToolName, risk: 'low', effect: 'read' }, ...DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS]
    .filter((contract) => contract.toolName !== options.omitted)
    .map((contract) => ({
      id: contract.toolName,
      label: contract.toolName,
      description: contract.toolName,
      rawDescription: contract.toolName,
      source: 'plugin',
      pluginId: 'junqi-dingtalk',
      risk: contract.risk,
      tags: ['dingtalk', contract.effect],
    }));
  return {
    agentId: input.agentId,
    profile: 'full',
    groups: [{ id: 'plugins', label: 'Plugins', source: 'plugin', tools }],
  };
}

function schemaInvocation(contract, digest = 'a'.repeat(64)) {
  const parameters = contract.effect === 'read'
    ? {}
    : contract.toolName === 'junqi_dingtalk_todo_create'
      ? {
          title: { type: 'string', required: true },
          executors: { type: 'array', items: { type: 'string' }, required: true },
        }
      : contract.toolName === 'junqi_dingtalk_todo_update'
        ? {
            'task-id': { type: 'string', required: true },
            title: { type: 'string' },
          }
        : { 'task-id': { type: 'string', required: true } };
  const constraints = contract.toolName === 'junqi_dingtalk_todo_update'
    ? { require_one_of: [['title']] }
    : {};
  const details = {
    success: true,
    toolName: contract.toolName,
    dwsCanonicalPath: contract.canonicalPath,
    schemaDigest: digest,
    effect: contract.effect,
    risk: contract.risk,
    confirmation: contract.confirmation,
    idempotency: contract.idempotency,
    parameters,
    constraints,
  };
  return {
    ok: true,
    toolName: schemaToolName,
    source: 'plugin',
    output: { content: [{ type: 'text', text: JSON.stringify(details) }], details },
  };
}

function readInvocation(contract, digest = 'a'.repeat(64)) {
  const details = {
    success: true,
    toolName: contract.toolName,
    dwsCanonicalPath: contract.canonicalPath,
    profileRef: input.profile,
    schemaDigest: digest,
    observedAt: '2026-09-10T02:00:00.000Z',
    data: { ok: true, outcome: 'success', data: { privateReadPayload: contract.toolName } },
  };
  return {
    ok: true,
    toolName: contract.toolName,
    source: 'plugin',
    output: { content: [{ type: 'text', text: JSON.stringify(details) }], details },
  };
}

function writeInvocation(contract, taskId = 'task-controlled', digest = 'a'.repeat(64)) {
  const details = {
    success: true,
    toolName: contract.toolName,
    dwsCanonicalPath: contract.canonicalPath,
    profileRef: input.profile,
    schemaDigest: digest,
    observedAt: '2026-09-10T02:01:00.000Z',
    data: {
      ok: true,
      outcome: 'success',
      data: { taskId, verified: true, privateWritePayload: contract.toolName },
    },
    verification: {
      status: 'verified',
      resourceId: taskId,
      verifierToolName: contract.toolName,
      verifierCanonicalPath: contract.canonicalPath,
      verifierSchemaDigest: digest,
      observedAt: '2026-09-10T02:01:00.000Z',
    },
  };
  return {
    ok: true,
    toolName: contract.toolName,
    source: 'plugin',
    output: { content: [{ type: 'text', text: JSON.stringify(details) }], details },
  };
}

function approvalRequired(contract) {
  return {
    ok: false,
    toolName: contract.toolName,
    requiresApproval: true,
    error: { code: 'requires_approval', message: 'private approval description' },
  };
}

function runOptions(overrides = {}) {
  const byName = new Map(DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.map((contract) => [contract.toolName, contract]));
  return {
    input,
    gatewayUrl: 'wss://gateway.example.test/',
    gatewayToken: 'target-todo-token',
    schemaToolName,
    buildSchemaValidatedArguments() {},
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      if (params.name === schemaToolName) return schemaInvocation(byName.get(params.args.toolName));
      const contract = byName.get(params.name);
      if (contract.effect === 'read') return readInvocation(contract);
      if (params.confirm !== true) return approvalRequired(contract);
      return writeInvocation(contract);
    },
    ...overrides,
  };
}

async function runCli(args, stdin, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('scripts/verify-dingtalk-target-gateway-todo.mjs'),
      ...args,
    ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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

test('target Gateway Todo contracts are the fixed core-five and four writes', () => {
  assert.equal(DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.length, 9);
  assert.deepEqual(
    DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS.map(({ toolName, canonicalPath, idempotency }) => ({
      toolName,
      canonicalPath,
      idempotency,
    })),
    [
      { toolName: 'junqi_dingtalk_todo_create', canonicalPath: 'todo.shortcut_create', idempotency: 'non_idempotent' },
      { toolName: 'junqi_dingtalk_todo_update', canonicalPath: 'todo.shortcut_update', idempotency: 'idempotent' },
      { toolName: 'junqi_dingtalk_todo_complete', canonicalPath: 'todo.shortcut_complete', idempotency: 'idempotent' },
      { toolName: 'junqi_dingtalk_todo_reopen', canonicalPath: 'todo.shortcut_reopen', idempotency: 'idempotent' },
    ],
  );
});

test('target Gateway Todo write contracts match the shared plugin registry', async () => {
  const toolSpecsUrl = pathToFileURL(path.resolve('packages/junqi-dingtalk/src/tool-specs.ts')).href;
  const todoUrl = pathToFileURL(path.resolve('packages/junqi-dingtalk/src/target-todo-smoke.ts')).href;
  const source = [
    `import { DINGTALK_TOOL_SPEC_BY_NAME } from ${JSON.stringify(toolSpecsUrl)};`,
    `import { DINGTALK_TARGET_TODO_SMOKE_TOOL_NAMES } from ${JSON.stringify(todoUrl)};`,
    'const contracts = DINGTALK_TARGET_TODO_SMOKE_TOOL_NAMES.map((toolName) => {',
    '  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(toolName);',
    '  return { toolName, canonicalPath: spec.canonicalPath, effect: spec.effect, risk: spec.risk, confirmation: spec.confirmation, idempotency: spec.idempotency };',
    '});',
    'console.log(JSON.stringify(contracts));',
  ].join('\n');
  const result = await runNode(['--import', 'tsx', '--input-type=module', '--eval', source]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout),
    DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS.map(({ step: _step, ...contract }) => contract),
  );
});

test('target Gateway Todo arguments and input are explicit, closed and bounded', async () => {
  const openclawPackage = path.resolve('target-openclaw', 'package.json');
  const dingtalkPackage = path.resolve('target-dingtalk', 'package.json');
  assert.deepEqual(parseDingTalkTargetGatewayTodoArguments([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', openclawPackage,
    '--dingtalk-package', dingtalkPackage,
    '--acknowledge-todo-writes', DINGTALK_TARGET_GATEWAY_TODO_ACKNOWLEDGEMENT,
  ]), {
    gatewayUrl: 'wss://gateway.example.test/',
    packageJsonPath: openclawPackage,
    dingtalkPackageJsonPath: dingtalkPackage,
  });
  assert.throws(
    () => parseDingTalkTargetGatewayTodoInput({ ...input, extra: true }),
    (error) => error.code === 'TARGET_GATEWAY_TODO_INPUT_INVALID',
  );
  assert.throws(
    () => parseDingTalkTargetGatewayTodoInput({
      ...input,
      fixture: { ...input.fixture, executor: 'other-user' },
    }),
    (error) => error.code === 'TARGET_GATEWAY_TODO_INPUT_INVALID',
  );
  await assert.rejects(
    readDingTalkTargetGatewayTodoInput(Readable.from([Buffer.alloc(16_385, 97)])),
    (error) => error.code === 'TARGET_GATEWAY_TODO_INPUT_TOO_LARGE',
  );
});

test('target Gateway Todo preflights everything before five approved writes', async () => {
  const calls = [];
  const options = runOptions({
    async callGatewayFromCli(method, rpcOptions, params, clientOptions) {
      calls.push({ method, rpcOptions, params, clientOptions });
      return runOptions().callGatewayFromCli(method, rpcOptions, params, clientOptions);
    },
  });
  const result = await runDingTalkTargetGatewayTodo(options);
  assert.equal(result.status, 'PASSED');
  assert.equal(result.state, 'verified');
  assert.deepEqual(result.completedSteps, ['create', 'update', 'complete_initial', 'reopen', 'complete_final']);
  assert.equal(result.schemaVerifiedCount, 9);
  assert.equal(result.approvalPreflightCount, 4);
  assert.equal(result.readPassedCount, 5);
  assert.equal(result.writeVerifiedCount, 5);
  assert.match(result.resourceIdSha256, /^[a-f0-9]{64}$/);
  const invoked = calls.filter((call) => call.method === 'tools.invoke');
  assert.deepEqual(invoked.slice(0, 9).map((call) => call.params.name), Array(9).fill(schemaToolName));
  assert.deepEqual(invoked.slice(9, 13).map((call) => call.params.confirm), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(invoked.slice(13, 18).map((call) => call.params.name), DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.slice(0, 5).map((contract) => contract.toolName));
  assert.deepEqual(invoked.slice(18).map((call) => call.params.confirm), [true, true, true, true, true]);
  assert.deepEqual(invoked.slice(18).map((call) => call.params.args.arguments), [
    { title: input.fixture.title, executors: [input.fixture.executor] },
    { 'task-id': 'task-controlled', title: input.fixture.updatedTitle },
    { 'task-id': 'task-controlled' },
    { 'task-id': 'task-controlled' },
    { 'task-id': 'task-controlled' },
  ]);
  assert.equal(invoked.slice(18).every((call) => call.rpcOptions.timeout === '330000'), true);
  assert.equal(JSON.stringify(result).includes(input.profile), false);
  assert.equal(JSON.stringify(result).includes(input.fixture.title), false);
  assert.equal(JSON.stringify(result).includes('privateWritePayload'), false);
});

test('target Gateway Todo projection failure prevents every invoke', async () => {
  let invokeCount = 0;
  await assert.rejects(
    runDingTalkTargetGatewayTodo(runOptions({
      async callGatewayFromCli(method) {
        if (method === 'tools.effective') return effectiveResult({ omitted: 'junqi_dingtalk_todo_reopen' });
        invokeCount += 1;
        throw new Error('unexpected invoke');
      },
    })),
    (error) => error.code === 'TARGET_GATEWAY_DINGTALK_TOOL_MISSING',
  );
  assert.equal(invokeCount, 0);
});

test('target Gateway Todo Schema failure completes preflight and performs zero business calls', async () => {
  let businessCalls = 0;
  const result = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      if (params.name === schemaToolName) {
        const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.args.toolName);
        if (contract.toolName === 'junqi_dingtalk_todo_update') throw new Error('private schema failure');
        return schemaInvocation(contract);
      }
      businessCalls += 1;
      throw new Error('unexpected business call');
    },
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.schemaVerifiedCount, 8);
  assert.equal(result.writeRequestCount, 0);
  assert.equal(businessCalls, 0);
  assert.equal(JSON.stringify(result).includes('private schema failure'), false);
});

test('target Gateway Todo approval preflight failure prevents reads and writes', async () => {
  let readCalls = 0;
  let approvedWrites = 0;
  const result = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.args?.toolName || item.toolName === params.name);
      if (params.name === schemaToolName) return schemaInvocation(contract);
      if (contract.effect === 'read') readCalls += 1;
      if (params.confirm === true) approvedWrites += 1;
      if (contract.toolName === 'junqi_dingtalk_todo_complete') return { ok: false };
      return approvalRequired(contract);
    },
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.approvalPreflightCount, 3);
  assert.equal(readCalls, 0);
  assert.equal(approvedWrites, 0);
  assert.equal(result.writeRequestCount, 0);
});

test('target Gateway Todo core read failure completes the matrix and prevents writes', async () => {
  let readCalls = 0;
  let approvedWrites = 0;
  const result = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, _rpcOptions, params) {
      if (method === 'tools.effective') return effectiveResult();
      const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.args?.toolName || item.toolName === params.name);
      if (params.name === schemaToolName) return schemaInvocation(contract);
      if (contract.effect !== 'read') {
        if (params.confirm === true) approvedWrites += 1;
        return approvalRequired(contract);
      }
      readCalls += 1;
      if (contract.toolName === 'junqi_dingtalk_todo_due_today') throw new Error('private read failure');
      return readInvocation(contract);
    },
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(readCalls, 5);
  assert.equal(approvedWrites, 0);
  assert.equal(result.writeRequestCount, 0);
  assert.equal(JSON.stringify(result).includes('private read failure'), false);
});

test('target Gateway Todo denial and unknown execution stop without replay', async () => {
  let approvedWrites = 0;
  const denied = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, rpcOptions, params, clientOptions) {
      const base = runOptions();
      if (method === 'tools.effective' || params.name === schemaToolName || params.confirm !== true) {
        return base.callGatewayFromCli(method, rpcOptions, params, clientOptions);
      }
      approvedWrites += 1;
      const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.name);
      if (approvedWrites === 2) return approvalRequired(contract);
      return writeInvocation(contract);
    },
  }));
  assert.equal(denied.state, 'stopped_after_verified_write');
  assert.equal(denied.resourceId, 'task-controlled');
  assert.equal(approvedWrites, 2);

  approvedWrites = 0;
  const unknown = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, rpcOptions, params, clientOptions) {
      const base = runOptions();
      if (method === 'tools.effective' || params.name === schemaToolName || params.confirm !== true) {
        return base.callGatewayFromCli(method, rpcOptions, params, clientOptions);
      }
      approvedWrites += 1;
      const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.name);
      if (approvedWrites === 3) throw new Error('private transport failure');
      return writeInvocation(contract);
    },
  }));
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.resourceId, 'task-controlled');
  assert.equal(approvedWrites, 3);
  assert.equal(JSON.stringify(unknown).includes('private transport failure'), false);
});

test('target Gateway Todo resource mismatch stops before the next write', async () => {
  let approvedWrites = 0;
  const result = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, rpcOptions, params, clientOptions) {
      const base = runOptions();
      if (method === 'tools.effective' || params.name === schemaToolName || params.confirm !== true) {
        return base.callGatewayFromCli(method, rpcOptions, params, clientOptions);
      }
      approvedWrites += 1;
      const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.name);
      return writeInvocation(contract, approvedWrites === 2 ? 'wrong-task' : 'task-controlled');
    },
  }));
  assert.equal(result.state, 'unknown');
  assert.equal(result.failedStage, 'update');
  assert.equal(result.resourceId, 'task-controlled');
  assert.equal(approvedWrites, 2);

  approvedWrites = 0;
  const payloadMismatch = await runDingTalkTargetGatewayTodo(runOptions({
    async callGatewayFromCli(method, rpcOptions, params, clientOptions) {
      const base = runOptions();
      if (method === 'tools.effective' || params.name === schemaToolName || params.confirm !== true) {
        return base.callGatewayFromCli(method, rpcOptions, params, clientOptions);
      }
      approvedWrites += 1;
      const contract = DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.find((item) => item.toolName === params.name);
      const invocation = writeInvocation(contract);
      if (approvedWrites === 2) {
        invocation.output.details.data.data.taskId = 'wrong-task';
        invocation.output.content[0].text = JSON.stringify(invocation.output.details);
      }
      return invocation;
    },
  }));
  assert.equal(payloadMismatch.state, 'unknown');
  assert.equal(payloadMismatch.failedStage, 'update');
  assert.equal(payloadMismatch.resourceId, 'task-controlled');
  assert.equal(approvedWrites, 2);
});

test('target Gateway Todo CLI removes the token before imports and redacts fixture payload', async () => {
  const directory = await temporaryDirectory('junqi-target-gateway-todo-');
  const openclawRoot = path.join(directory, 'openclaw');
  const dingtalkRoot = path.join(directory, 'dingtalk');
  await mkdir(path.join(openclawRoot, 'dist'), { recursive: true });
  await mkdir(path.join(dingtalkRoot, 'dist'), { recursive: true });
  await writeFile(path.join(openclawRoot, 'package.json'), JSON.stringify({
    name: 'openclaw',
    version: 'target-test',
    type: 'module',
    exports: { './plugin-sdk/gateway-runtime': './dist/gateway-runtime.js' },
  }));
  await writeFile(path.join(openclawRoot, 'dist', 'gateway-runtime.js'), `
if (process.env.OPENCLAW_GATEWAY_TOKEN) throw new Error('TOKEN_VISIBLE_DURING_IMPORT');
export async function callGatewayFromCli(method) {
  if (method === 'tools.effective') return { agentId: 'main', groups: [] };
  throw new Error('unexpected');
}
`);
  await writeFile(path.join(dingtalkRoot, 'package.json'), JSON.stringify({
    name: '@junqi/openclaw-dingtalk-business',
    version: 'target-test',
    type: 'module',
  }));
  await writeFile(path.join(dingtalkRoot, 'dist', 'schema-contract.js'), `
if (process.env.OPENCLAW_GATEWAY_TOKEN) throw new Error('TOKEN_VISIBLE_DURING_IMPORT');
export function buildSchemaValidatedArguments() { return []; }
`);
  await writeFile(path.join(dingtalkRoot, 'dist', 'tool-specs.js'), `
if (process.env.OPENCLAW_GATEWAY_TOKEN) throw new Error('TOKEN_VISIBLE_DURING_IMPORT');
export const TOOL_SCHEMA_TOOL_NAME = 'junqi_dingtalk_tool_schema';
`);
  const result = await runCli([
    '--gateway-url', 'wss://gateway.example.test',
    '--openclaw-package', path.join(openclawRoot, 'package.json'),
    '--dingtalk-package', path.join(dingtalkRoot, 'package.json'),
    '--acknowledge-todo-writes', DINGTALK_TARGET_GATEWAY_TODO_ACKNOWLEDGEMENT,
  ], JSON.stringify(input), { ...process.env, OPENCLAW_GATEWAY_TOKEN: 'private-target-token' });
  assert.equal(result.code, 1);
  assert.equal(result.stderr.includes('TOKEN_VISIBLE_DURING_IMPORT'), false);
  assert.equal(result.stderr.includes('private-target-token'), false);
  assert.equal(result.stderr.includes(input.profile), false);
  assert.equal(result.stderr.includes(input.fixture.title), false);
});

test('target Gateway Todo fatal failures retain only a stable code', () => {
  const result = serializeDingTalkTargetGatewayTodoFailure(new Error('private fatal details'));
  assert.deepEqual(Object.keys(result), ['formatVersion', 'kind', 'status', 'code']);
  assert.equal(JSON.stringify(result).includes('private fatal details'), false);
});
