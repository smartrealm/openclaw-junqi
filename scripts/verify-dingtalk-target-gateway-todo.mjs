#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  DingTalkTargetGatewayReadFailure,
  assertDingTalkTargetEffectiveReadToolContract,
  assertDingTalkTargetReadInvocationContract,
  parseDingTalkTargetGatewayConnection,
  parseDingTalkTargetGatewayReadInput,
  resolveOpenClawGatewayRuntime,
  validateDingTalkTargetGatewayToken,
} from './verify-dingtalk-target-gateway-read.mjs';
import {
  DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE,
  stableDingTalkTargetGatewayFailureCode,
} from './verify-dingtalk-target-gateway-readonly.mjs';
import {
  assertDingTalkTargetApprovalPreflight,
  assertDingTalkTargetEffectiveSideEffectTool,
  assertDingTalkTargetSchemaInvocation,
  assertDingTalkTargetVerifiedWrite,
  dingTalkTargetWriteFailure,
  isDingTalkTargetApprovalStop,
  isTargetGatewayRecord,
  resolveDingTalkWriteVerifierRuntime,
  targetGatewayWriteInvariant,
} from './dingtalk-target-gateway-write-verifier.mjs';

const SCRIPT_PATH = await realpath(new URL(import.meta.url));
const INPUT_LIMIT_BYTES = 16_384;
const WRITE_TIMEOUT = '330000';
const PREFLIGHT_TASK_ID = 'todo-gateway-preflight-task';

export const DINGTALK_TARGET_GATEWAY_TODO_ACKNOWLEDGEMENT =
  'JUNQI_DINGTALK_TARGET_GATEWAY_TODO_CREATE_UPDATE_COMPLETE_REOPEN_COMPLETE';

const READ_CONTRACTS = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.core.map((contract) => ({
  ...contract,
  effect: 'read',
  risk: 'low',
  confirmation: 'not_required',
  idempotency: 'idempotent',
}));

export const DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS = [
  {
    toolName: 'junqi_dingtalk_todo_create',
    canonicalPath: 'todo.shortcut_create',
    effect: 'write',
    risk: 'medium',
    confirmation: 'user_required',
    idempotency: 'non_idempotent',
    step: 'create',
  },
  {
    toolName: 'junqi_dingtalk_todo_update',
    canonicalPath: 'todo.shortcut_update',
    effect: 'write',
    risk: 'medium',
    confirmation: 'user_required',
    idempotency: 'idempotent',
    step: 'update',
  },
  {
    toolName: 'junqi_dingtalk_todo_complete',
    canonicalPath: 'todo.shortcut_complete',
    effect: 'write',
    risk: 'medium',
    confirmation: 'user_required',
    idempotency: 'idempotent',
    step: 'complete',
  },
  {
    toolName: 'junqi_dingtalk_todo_reopen',
    canonicalPath: 'todo.shortcut_reopen',
    effect: 'write',
    risk: 'medium',
    confirmation: 'user_required',
    idempotency: 'idempotent',
    step: 'reopen',
  },
];

export const DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS = [
  ...READ_CONTRACTS,
  ...DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS,
];

function assertClosedKeys(value, requiredKeys, code, label) {
  const actual = Object.keys(value).sort();
  targetGatewayWriteInvariant(
    JSON.stringify(actual) === JSON.stringify([...requiredKeys].sort()),
    code,
    `${label} fields do not match the closed contract`,
  );
}

function normalizedText(value, field, maximumLength) {
  targetGatewayWriteInvariant(typeof value === 'string', 'TARGET_GATEWAY_TODO_INPUT_INVALID', `${field} must be a string`);
  const normalized = value.trim();
  targetGatewayWriteInvariant(normalized.length > 0, 'TARGET_GATEWAY_TODO_INPUT_INVALID', `${field} must not be empty`);
  targetGatewayWriteInvariant(normalized.length <= maximumLength, 'TARGET_GATEWAY_TODO_INPUT_INVALID', `${field} is too long`);
  targetGatewayWriteInvariant(!/[\r\n\0]/.test(normalized), 'TARGET_GATEWAY_TODO_INPUT_INVALID', `${field} contains forbidden characters`);
  return normalized;
}

export function parseDingTalkTargetGatewayTodoArguments(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  targetGatewayWriteInvariant(normalized.length % 2 === 0, 'TARGET_GATEWAY_TODO_ARGUMENTS_INVALID', 'Every flag requires one value');
  const supported = new Set([
    '--gateway-url',
    '--openclaw-package',
    '--dingtalk-package',
    '--acknowledge-todo-writes',
  ]);
  const values = new Map();
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index];
    const value = normalized[index + 1];
    targetGatewayWriteInvariant(supported.has(flag), 'TARGET_GATEWAY_TODO_ARGUMENTS_INVALID', 'Unsupported target Gateway Todo argument');
    targetGatewayWriteInvariant(!values.has(flag), 'TARGET_GATEWAY_TODO_ARGUMENTS_INVALID', 'Duplicate target Gateway Todo argument');
    targetGatewayWriteInvariant(typeof value === 'string' && value.length > 0, 'TARGET_GATEWAY_TODO_ARGUMENTS_INVALID', 'Target Gateway Todo argument value is missing');
    values.set(flag, value);
  }
  targetGatewayWriteInvariant(values.size === supported.size, 'TARGET_GATEWAY_TODO_ARGUMENTS_INVALID', 'Target Gateway Todo arguments are incomplete');
  targetGatewayWriteInvariant(
    values.get('--acknowledge-todo-writes') === DINGTALK_TARGET_GATEWAY_TODO_ACKNOWLEDGEMENT,
    'TARGET_GATEWAY_TODO_ACKNOWLEDGEMENT_INVALID',
    'Target Gateway Todo write acknowledgement is invalid',
  );
  const dingtalkPackageJsonPath = values.get('--dingtalk-package');
  targetGatewayWriteInvariant(path.isAbsolute(dingtalkPackageJsonPath), 'DINGTALK_PACKAGE_PATH_INVALID', 'DingTalk package.json path must be absolute');
  targetGatewayWriteInvariant(path.basename(dingtalkPackageJsonPath) === 'package.json', 'DINGTALK_PACKAGE_PATH_INVALID', 'DingTalk package path must identify package.json');
  return {
    ...parseDingTalkTargetGatewayConnection(
      values.get('--gateway-url'),
      values.get('--openclaw-package'),
    ),
    dingtalkPackageJsonPath: path.normalize(dingtalkPackageJsonPath),
  };
}

export function parseDingTalkTargetGatewayTodoInput(value) {
  targetGatewayWriteInvariant(isTargetGatewayRecord(value), 'TARGET_GATEWAY_TODO_INPUT_INVALID', 'Target Gateway Todo input must be an object');
  assertClosedKeys(value, ['agentId', 'sessionKey', 'profile', 'fixture'], 'TARGET_GATEWAY_TODO_INPUT_INVALID', 'Target Gateway Todo input');
  targetGatewayWriteInvariant(isTargetGatewayRecord(value.fixture), 'TARGET_GATEWAY_TODO_INPUT_INVALID', 'Target Gateway Todo fixture must be an object');
  assertClosedKeys(value.fixture, ['executor', 'title', 'updatedTitle'], 'TARGET_GATEWAY_TODO_INPUT_INVALID', 'Target Gateway Todo fixture');
  const connection = parseDingTalkTargetGatewayReadInput({
    agentId: value.agentId,
    sessionKey: value.sessionKey,
    profile: value.profile,
  });
  const executor = normalizedText(value.fixture.executor, 'fixture.executor', 512);
  const title = normalizedText(value.fixture.title, 'fixture.title', 2_048);
  const updatedTitle = normalizedText(value.fixture.updatedTitle, 'fixture.updatedTitle', 2_048);
  const profileUser = connection.profile.slice(connection.profile.indexOf(':') + 1);
  targetGatewayWriteInvariant(executor === profileUser, 'TARGET_GATEWAY_TODO_INPUT_INVALID', 'Todo executor must equal the user in profile');
  targetGatewayWriteInvariant(title !== updatedTitle, 'TARGET_GATEWAY_TODO_INPUT_INVALID', 'Todo titles must differ');
  return { ...connection, fixture: { executor, title, updatedTitle } };
}

export async function readDingTalkTargetGatewayTodoInput(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    targetGatewayWriteInvariant(bytes <= INPUT_LIMIT_BYTES, 'TARGET_GATEWAY_TODO_INPUT_TOO_LARGE', 'Target Gateway Todo input exceeds 16 KiB');
    chunks.push(buffer);
  }
  targetGatewayWriteInvariant(bytes > 0, 'TARGET_GATEWAY_TODO_INPUT_REQUIRED', 'Target Gateway Todo input is required');
  let document;
  try {
    document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_TODO_INPUT_INVALID', 'Target Gateway Todo input must be JSON');
  }
  return parseDingTalkTargetGatewayTodoInput(document);
}

function writeArguments(contract, fixture, taskId) {
  if (contract.step === 'create') return { title: fixture.title, executors: [fixture.executor] };
  if (contract.step === 'update') return { 'task-id': taskId, title: fixture.updatedTitle };
  return { 'task-id': taskId };
}

function writeStages() {
  const contracts = new Map(DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS.map((contract) => [contract.step, contract]));
  return [
    { name: 'create', contract: contracts.get('create') },
    { name: 'update', contract: contracts.get('update') },
    { name: 'complete_initial', contract: contracts.get('complete') },
    { name: 'reopen', contract: contracts.get('reopen') },
    { name: 'complete_final', contract: contracts.get('complete') },
  ];
}

function evidence(input) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_TODO_CREATE_UPDATE_COMPLETE_REOPEN_COMPLETE',
    status: input.status,
    state: input.state,
    checkedContractCount: DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS.length,
    schemaVerifiedCount: input.schemaVerifiedCount,
    argumentValidatedCount: input.argumentValidatedCount,
    approvalPreflightCount: input.approvalPreflightCount,
    readAttemptedCount: input.readAttemptedCount,
    readPassedCount: input.readPassedCount,
    writeRequestCount: input.writeRequestCount,
    writeVerifiedCount: input.completedSteps.length,
    completedSteps: input.completedSteps,
    ...(input.failedStage ? { failedStage: input.failedStage } : {}),
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.resourceIdSha256 ? { resourceIdSha256: input.resourceIdSha256 } : {}),
    failures: input.failures,
    recovery: input.recovery,
    scopes: {
      effectiveTools: ['operator.read'],
      schemaInvocation: ['operator.write'],
      approvalAndToolInvocation: ['operator.write'],
    },
    retained: {
      gatewayToken: false,
      sessionKey: false,
      profileRef: false,
      todoFixture: false,
      businessPayload: false,
    },
  };
}

export async function runDingTalkTargetGatewayTodo(options) {
  const input = parseDingTalkTargetGatewayTodoInput(options.input);
  const token = validateDingTalkTargetGatewayToken(options.gatewayToken);
  const effective = await options.callGatewayFromCli(
    'tools.effective',
    { url: options.gatewayUrl, token, timeout: '30000', json: true },
    { sessionKey: input.sessionKey, agentId: input.agentId },
    { deviceIdentity: null, progress: false, scopes: ['operator.read'], sharedStateMode: 'read-only' },
  );
  assertDingTalkTargetEffectiveReadToolContract(effective, input.agentId, { toolName: options.schemaToolName });
  for (const contract of READ_CONTRACTS) {
    assertDingTalkTargetEffectiveReadToolContract(effective, input.agentId, contract);
  }
  for (const contract of DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS) {
    assertDingTalkTargetEffectiveSideEffectTool(effective, input.agentId, contract);
  }

  const schemas = new Map();
  const failures = [];
  let schemaVerifiedCount = 0;
  let argumentValidatedCount = 0;
  for (const contract of DINGTALK_TARGET_GATEWAY_TODO_CONTRACTS) {
    try {
      const result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: '30000', json: true },
        {
          name: options.schemaToolName,
          args: { toolName: contract.toolName },
          sessionKey: input.sessionKey,
          agentId: input.agentId,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
      const verified = assertDingTalkTargetSchemaInvocation(result, options.schemaToolName, contract, 'TARGET_GATEWAY_TODO_SCHEMA_INVALID');
      schemaVerifiedCount += 1;
      schemas.set(contract.toolName, verified);
      options.buildSchemaValidatedArguments(
        verified.schema,
        contract.effect === 'read' ? {} : writeArguments(contract, input.fixture, PREFLIGHT_TASK_ID),
      );
      argumentValidatedCount += 1;
    } catch (error) {
      failures.push(dingTalkTargetWriteFailure(contract, schemas.has(contract.toolName) ? 'arguments' : 'schema', error));
    }
  }
  if (failures.length > 0) {
    return evidence({
      status: 'FAILED',
      state: 'failed_before_write',
      schemaVerifiedCount,
      argumentValidatedCount,
      approvalPreflightCount: 0,
      readAttemptedCount: 0,
      readPassedCount: 0,
      writeRequestCount: 0,
      completedSteps: [],
      failures,
      recovery: 'fix_contract_before_retry',
    });
  }

  let approvalPreflightCount = 0;
  for (const contract of DINGTALK_TARGET_GATEWAY_TODO_WRITE_CONTRACTS) {
    try {
      const result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: '30000', json: true },
        {
          name: contract.toolName,
          args: {
            profile: input.profile,
            arguments: writeArguments(contract, input.fixture, PREFLIGHT_TASK_ID),
          },
          sessionKey: input.sessionKey,
          agentId: input.agentId,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
      assertDingTalkTargetApprovalPreflight(result, contract, 'TARGET_GATEWAY_TODO_APPROVAL_PREFLIGHT_INVALID');
      approvalPreflightCount += 1;
    } catch (error) {
      failures.push(dingTalkTargetWriteFailure(contract, 'approval_preflight', error));
    }
  }
  if (failures.length > 0) {
    return evidence({
      status: 'FAILED',
      state: 'failed_before_write',
      schemaVerifiedCount,
      argumentValidatedCount,
      approvalPreflightCount,
      readAttemptedCount: 0,
      readPassedCount: 0,
      writeRequestCount: 0,
      completedSteps: [],
      failures,
      recovery: 'fix_approval_boundary_before_retry',
    });
  }

  let readAttemptedCount = 0;
  let readPassedCount = 0;
  for (const contract of READ_CONTRACTS) {
    readAttemptedCount += 1;
    try {
      const result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: '30000', json: true },
        {
          name: contract.toolName,
          args: { profile: input.profile, arguments: {} },
          sessionKey: input.sessionKey,
          agentId: input.agentId,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
      const verified = assertDingTalkTargetReadInvocationContract(result, input.profile, contract);
      targetGatewayWriteInvariant(
        verified.schemaDigest === schemas.get(contract.toolName)?.digest,
        'TARGET_GATEWAY_TODO_SCHEMA_CHANGED',
        'DingTalk Schema changed between preflight and core read',
      );
      readPassedCount += 1;
    } catch (error) {
      failures.push(dingTalkTargetWriteFailure(contract, 'readonly_preflight', error));
    }
  }
  if (failures.length > 0) {
    return evidence({
      status: 'FAILED',
      state: 'failed_before_write',
      schemaVerifiedCount,
      argumentValidatedCount,
      approvalPreflightCount,
      readAttemptedCount,
      readPassedCount,
      writeRequestCount: 0,
      completedSteps: [],
      failures,
      recovery: 'fix_read_access_before_retry',
    });
  }

  const completedSteps = [];
  let taskId;
  let writeRequestCount = 0;
  for (const stage of writeStages()) {
    const argumentsValue = writeArguments(stage.contract, input.fixture, taskId);
    writeRequestCount += 1;
    let result;
    try {
      result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: WRITE_TIMEOUT, json: true },
        {
          name: stage.contract.toolName,
          args: { profile: input.profile, arguments: argumentsValue },
          sessionKey: input.sessionKey,
          agentId: input.agentId,
          confirm: true,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
    } catch (error) {
      return evidence({
        status: 'FAILED',
        state: 'unknown',
        schemaVerifiedCount,
        argumentValidatedCount,
        approvalPreflightCount,
        readAttemptedCount,
        readPassedCount,
        writeRequestCount,
        completedSteps,
        failedStage: stage.name,
        ...(taskId ? { resourceId: taskId } : {}),
        failures: [dingTalkTargetWriteFailure(stage.contract, 'write', error)],
        recovery: taskId
          ? 'inspect_exact_task_before_any_action'
          : 'inspect_by_unique_title_before_any_retry',
      });
    }
    if (isDingTalkTargetApprovalStop(result, stage.contract)) {
      return evidence({
        status: 'FAILED',
        state: completedSteps.length === 0 ? 'failed_before_write' : 'stopped_after_verified_write',
        schemaVerifiedCount,
        argumentValidatedCount,
        approvalPreflightCount,
        readAttemptedCount,
        readPassedCount,
        writeRequestCount,
        completedSteps,
        failedStage: stage.name,
        ...(taskId ? { resourceId: taskId } : {}),
        failures: [dingTalkTargetWriteFailure(stage.contract, 'approval', new DingTalkTargetGatewayReadFailure(
          'TARGET_GATEWAY_TODO_APPROVAL_NOT_GRANTED',
          'Todo approval was not granted',
        ))],
        recovery: taskId
          ? 'inspect_exact_task_before_any_action'
          : 'request_fresh_approval_before_retry',
      });
    }
    let verified;
    try {
      verified = assertDingTalkTargetVerifiedWrite(
        result,
        input.profile,
        stage.contract,
        schemas.get(stage.contract.toolName)?.digest,
        'taskId',
        'TARGET_GATEWAY_TODO_WRITE_UNKNOWN',
      );
      if (taskId) {
        targetGatewayWriteInvariant(
          verified.resourceId === taskId,
          'TARGET_GATEWAY_TODO_RESOURCE_MISMATCH',
          'Todo write returned a different taskId',
        );
      }
    } catch (error) {
      return evidence({
        status: 'FAILED',
        state: 'unknown',
        schemaVerifiedCount,
        argumentValidatedCount,
        approvalPreflightCount,
        readAttemptedCount,
        readPassedCount,
        writeRequestCount,
        completedSteps,
        failedStage: stage.name,
        ...(taskId ? { resourceId: taskId } : {}),
        failures: [dingTalkTargetWriteFailure(stage.contract, 'write_verification', error)],
        recovery: taskId
          ? 'inspect_exact_task_before_any_action'
          : 'inspect_by_unique_title_before_any_retry',
      });
    }
    taskId = verified.resourceId;
    completedSteps.push(stage.name);
  }

  return evidence({
    status: 'PASSED',
    state: 'verified',
    schemaVerifiedCount,
    argumentValidatedCount,
    approvalPreflightCount,
    readAttemptedCount,
    readPassedCount,
    writeRequestCount,
    completedSteps,
    resourceIdSha256: createHash('sha256').update(taskId).digest('hex'),
    failures: [],
    recovery: 'none',
  });
}

export function serializeDingTalkTargetGatewayTodoFailure(error) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_TODO_CREATE_UPDATE_COMPLETE_REOPEN_COMPLETE',
    status: 'FAILED',
    code: stableDingTalkTargetGatewayFailureCode(error),
  };
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === SCRIPT_PATH) {
  try {
    const args = parseDingTalkTargetGatewayTodoArguments(process.argv.slice(2));
    const input = await readDingTalkTargetGatewayTodoInput(process.stdin);
    const gatewayToken = validateDingTalkTargetGatewayToken(process.env.OPENCLAW_GATEWAY_TOKEN);
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const [openClawRuntime, dingtalkRuntime] = await Promise.all([
      resolveOpenClawGatewayRuntime(args.packageJsonPath),
      resolveDingTalkWriteVerifierRuntime(args.dingtalkPackageJsonPath),
    ]);
    const result = await runDingTalkTargetGatewayTodo({
      callGatewayFromCli: openClawRuntime.callGatewayFromCli,
      gatewayUrl: args.gatewayUrl,
      gatewayToken,
      input,
      schemaToolName: dingtalkRuntime.schemaToolName,
      buildSchemaValidatedArguments: dingtalkRuntime.buildSchemaValidatedArguments,
    });
    console.log(JSON.stringify({
      ...result,
      openClawPackageVersion: openClawRuntime.packageVersion,
      dingtalkPackageVersion: dingtalkRuntime.packageVersion,
    }, null, 2));
    if (result.status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(serializeDingTalkTargetGatewayTodoFailure(error)));
    process.exitCode = 1;
  }
}
