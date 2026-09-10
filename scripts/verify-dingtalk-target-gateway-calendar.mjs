#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DINGTALK_TARGET_GATEWAY_READ_PLUGIN,
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

const SCRIPT_PATH = await realpath(new URL(import.meta.url));
const INPUT_LIMIT_BYTES = 16_384;
const WRITE_TIMEOUT = '330000';
const PREFLIGHT_EVENT_ID = 'calendar-gateway-preflight-event';

export const DINGTALK_TARGET_GATEWAY_CALENDAR_ACKNOWLEDGEMENT =
  'JUNQI_DINGTALK_TARGET_GATEWAY_CALENDAR_CREATE_UPDATE_CANCEL';

const READ_CONTRACTS = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE.core.map((contract) => ({
  ...contract,
  effect: 'read',
  risk: 'low',
  confirmation: 'not_required',
  idempotency: 'idempotent',
}));

export const DINGTALK_TARGET_GATEWAY_CALENDAR_WRITE_CONTRACTS = [
  {
    toolName: 'junqi_dingtalk_calendar_create',
    canonicalPath: 'calendar.shortcut_create',
    effect: 'write',
    risk: 'medium',
    confirmation: 'user_required',
    idempotency: 'unknown',
    step: 'create',
  },
  {
    toolName: 'junqi_dingtalk_calendar_update',
    canonicalPath: 'calendar.shortcut_update',
    effect: 'write',
    risk: 'medium',
    confirmation: 'user_required',
    idempotency: 'unknown',
    step: 'update',
  },
  {
    toolName: 'junqi_dingtalk_calendar_cancel',
    canonicalPath: 'calendar.shortcut_cancel_event',
    effect: 'destructive',
    risk: 'high',
    confirmation: 'user_required',
    idempotency: 'unknown',
    step: 'cancel',
  },
];

export const DINGTALK_TARGET_GATEWAY_CALENDAR_CONTRACTS = [
  ...READ_CONTRACTS,
  ...DINGTALK_TARGET_GATEWAY_CALENDAR_WRITE_CONTRACTS,
];

function invariant(condition, code, message) {
  if (!condition) throw new DingTalkTargetGatewayReadFailure(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertClosedKeys(value, requiredKeys, optionalKeys, code, label) {
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  invariant(
    requiredKeys.every((key) => Object.hasOwn(value, key))
      && actual.every((key) => allowed.has(key))
      && actual.length >= required.size,
    code,
    `${label} fields do not match the closed contract`,
  );
}

function normalizedText(value, field, maximumLength) {
  invariant(typeof value === 'string', 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', `${field} must be a string`);
  const normalized = value.trim();
  invariant(normalized.length > 0, 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', `${field} must not be empty`);
  invariant(normalized.length <= maximumLength, 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', `${field} is too long`);
  invariant(!/[\r\n\0]/.test(normalized), 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', `${field} contains forbidden characters`);
  return normalized;
}

function normalizedTimestamp(value, field) {
  const normalized = normalizedText(value, field, 128);
  invariant(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
      && !Number.isNaN(Date.parse(normalized)),
    'TARGET_GATEWAY_CALENDAR_INPUT_INVALID',
    `${field} must be an RFC3339 timestamp with an explicit offset`,
  );
  return normalized;
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function parseDingTalkTargetGatewayCalendarArguments(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  invariant(normalized.length % 2 === 0, 'TARGET_GATEWAY_CALENDAR_ARGUMENTS_INVALID', 'Every flag requires one value');
  const supported = new Set([
    '--gateway-url',
    '--openclaw-package',
    '--dingtalk-package',
    '--acknowledge-calendar-writes',
  ]);
  const values = new Map();
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index];
    const value = normalized[index + 1];
    invariant(supported.has(flag), 'TARGET_GATEWAY_CALENDAR_ARGUMENTS_INVALID', 'Unsupported target Gateway calendar argument');
    invariant(!values.has(flag), 'TARGET_GATEWAY_CALENDAR_ARGUMENTS_INVALID', 'Duplicate target Gateway calendar argument');
    invariant(typeof value === 'string' && value.length > 0, 'TARGET_GATEWAY_CALENDAR_ARGUMENTS_INVALID', 'Target Gateway calendar argument value is missing');
    values.set(flag, value);
  }
  invariant(values.size === supported.size, 'TARGET_GATEWAY_CALENDAR_ARGUMENTS_INVALID', 'Target Gateway calendar arguments are incomplete');
  invariant(
    values.get('--acknowledge-calendar-writes') === DINGTALK_TARGET_GATEWAY_CALENDAR_ACKNOWLEDGEMENT,
    'TARGET_GATEWAY_CALENDAR_ACKNOWLEDGEMENT_INVALID',
    'Target Gateway calendar write acknowledgement is invalid',
  );
  const dingtalkPackageJsonPath = values.get('--dingtalk-package');
  invariant(path.isAbsolute(dingtalkPackageJsonPath), 'DINGTALK_PACKAGE_PATH_INVALID', 'DingTalk package.json path must be absolute');
  invariant(path.basename(dingtalkPackageJsonPath) === 'package.json', 'DINGTALK_PACKAGE_PATH_INVALID', 'DingTalk package path must identify package.json');
  return {
    ...parseDingTalkTargetGatewayConnection(
      values.get('--gateway-url'),
      values.get('--openclaw-package'),
    ),
    dingtalkPackageJsonPath: path.normalize(dingtalkPackageJsonPath),
  };
}

export function parseDingTalkTargetGatewayCalendarInput(value) {
  invariant(isRecord(value), 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', 'Target Gateway calendar input must be an object');
  assertClosedKeys(
    value,
    ['agentId', 'sessionKey', 'profile', 'fixture'],
    [],
    'TARGET_GATEWAY_CALENDAR_INPUT_INVALID',
    'Target Gateway calendar input',
  );
  invariant(isRecord(value.fixture), 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', 'Target Gateway calendar fixture must be an object');
  assertClosedKeys(
    value.fixture,
    ['title', 'updatedTitle', 'start', 'end'],
    ['timezone'],
    'TARGET_GATEWAY_CALENDAR_INPUT_INVALID',
    'Target Gateway calendar fixture',
  );
  const connection = parseDingTalkTargetGatewayReadInput({
    agentId: value.agentId,
    sessionKey: value.sessionKey,
    profile: value.profile,
  });
  const title = normalizedText(value.fixture.title, 'fixture.title', 2_048);
  const updatedTitle = normalizedText(value.fixture.updatedTitle, 'fixture.updatedTitle', 2_048);
  invariant(title !== updatedTitle, 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', 'Calendar titles must differ');
  const start = normalizedTimestamp(value.fixture.start, 'fixture.start');
  const end = normalizedTimestamp(value.fixture.end, 'fixture.end');
  invariant(Date.parse(start) < Date.parse(end), 'TARGET_GATEWAY_CALENDAR_INPUT_INVALID', 'Calendar end must be after start');
  let timezone;
  if (value.fixture.timezone !== undefined) {
    timezone = normalizedText(value.fixture.timezone, 'fixture.timezone', 128);
    invariant(
      /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timezone),
      'TARGET_GATEWAY_CALENDAR_INPUT_INVALID',
      'Calendar timezone must be an IANA timezone name',
    );
  }
  return {
    ...connection,
    fixture: {
      title,
      updatedTitle,
      start,
      end,
      ...(timezone ? { timezone } : {}),
    },
  };
}

export async function readDingTalkTargetGatewayCalendarInput(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    invariant(bytes <= INPUT_LIMIT_BYTES, 'TARGET_GATEWAY_CALENDAR_INPUT_TOO_LARGE', 'Target Gateway calendar input exceeds 16 KiB');
    chunks.push(buffer);
  }
  invariant(bytes > 0, 'TARGET_GATEWAY_CALENDAR_INPUT_REQUIRED', 'Target Gateway calendar input is required');
  let document;
  try {
    document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_CALENDAR_INPUT_INVALID', 'Target Gateway calendar input must be JSON');
  }
  return parseDingTalkTargetGatewayCalendarInput(document);
}

export async function resolveDingTalkCalendarVerifierRuntime(packageJsonPath) {
  const resolvedPackageJson = await realpath(packageJsonPath).catch(() => null);
  invariant(resolvedPackageJson !== null, 'DINGTALK_PACKAGE_INVALID', 'DingTalk package.json is unavailable');
  invariant(path.basename(resolvedPackageJson) === 'package.json', 'DINGTALK_PACKAGE_INVALID', 'Resolved DingTalk package path is not package.json');
  const packageRoot = path.dirname(resolvedPackageJson);
  let packageDocument;
  try {
    packageDocument = JSON.parse(await readFile(resolvedPackageJson, 'utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('DINGTALK_PACKAGE_INVALID', 'DingTalk package.json is invalid');
  }
  invariant(
    isRecord(packageDocument) && packageDocument.name === '@junqi/openclaw-dingtalk-business',
    'DINGTALK_PACKAGE_INVALID',
    'Target package is not the JunQi DingTalk plugin',
  );
  const modulePaths = [];
  for (const moduleName of ['schema-contract.js', 'tool-specs.js']) {
    const unresolved = path.resolve(packageRoot, 'dist', moduleName);
    invariant(containedPath(packageRoot, unresolved), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module escapes the package');
    const resolved = await realpath(unresolved).catch(() => null);
    invariant(resolved !== null && containedPath(packageRoot, resolved), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module is unavailable');
    const moduleStats = await stat(resolved).catch(() => null);
    invariant(moduleStats?.isFile(), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module is not a regular file');
    modulePaths.push(resolved);
  }
  const [schemaModule, toolSpecsModule] = await Promise.all(
    modulePaths.map((modulePath) => import(pathToFileURL(modulePath).href)),
  );
  invariant(typeof schemaModule.buildSchemaValidatedArguments === 'function', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier argument validator is missing');
  invariant(typeof toolSpecsModule.TOOL_SCHEMA_TOOL_NAME === 'string', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier Schema tool identity is missing');
  return {
    packageVersion: typeof packageDocument.version === 'string' ? packageDocument.version : null,
    buildSchemaValidatedArguments: schemaModule.buildSchemaValidatedArguments,
    schemaToolName: toolSpecsModule.TOOL_SCHEMA_TOOL_NAME,
  };
}

function findEffectiveTool(value, expectedAgentId, contract) {
  invariant(isRecord(value), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory must be an object');
  invariant(value.agentId === expectedAgentId, 'TARGET_GATEWAY_AGENT_MISMATCH', 'Effective tool inventory resolved a different Agent');
  invariant(Array.isArray(value.groups), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory groups are missing');
  const matches = value.groups
    .filter((group) => isRecord(group) && group.source === 'plugin' && Array.isArray(group.tools))
    .flatMap((group) => group.tools)
    .filter((tool) => isRecord(tool) && tool.id === contract.toolName);
  invariant(matches.length === 1, 'TARGET_GATEWAY_DINGTALK_TOOL_MISSING', 'Effective inventory must contain exactly one expected DingTalk tool');
  return matches[0];
}

function assertDingTalkTargetEffectiveCalendarWriteTool(value, expectedAgentId, contract) {
  const tool = findEffectiveTool(value, expectedAgentId, contract);
  invariant(tool.source === 'plugin' && tool.pluginId === DINGTALK_TARGET_GATEWAY_READ_PLUGIN, 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk calendar tool has the wrong plugin owner');
  invariant(tool.deniedBySession !== true, 'TARGET_GATEWAY_DINGTALK_TOOL_DENIED', 'DingTalk calendar tool is denied by the target Session');
  invariant(tool.risk === contract.risk, 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk calendar tool risk differs from the reviewed contract');
  invariant(
    Array.isArray(tool.tags) && tool.tags.includes('dingtalk') && tool.tags.includes(contract.effect),
    'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID',
    'DingTalk calendar tool tags differ from the reviewed contract',
  );
}

function assertSchemaInvocation(value, schemaToolName, contract) {
  invariant(isRecord(value), 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema invocation result must be an object');
  invariant(value.ok === true && value.toolName === schemaToolName && value.source === 'plugin', 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema invocation identity is invalid');
  invariant(isRecord(value.output) && isRecord(value.output.details), 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema invocation details are missing');
  const details = value.output.details;
  invariant(
    details.success === true
      && details.toolName === contract.toolName
      && details.dwsCanonicalPath === contract.canonicalPath,
    'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID',
    'DingTalk Schema invocation returned the wrong contract',
  );
  invariant(typeof details.schemaDigest === 'string' && /^[a-f0-9]{64}$/.test(details.schemaDigest), 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema digest is invalid');
  invariant(
    details.effect === contract.effect
      && details.risk === contract.risk
      && details.confirmation === contract.confirmation
      && details.idempotency === contract.idempotency,
    'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID',
    'DingTalk Schema safety contract differs from the reviewed contract',
  );
  invariant(isRecord(details.parameters) && isRecord(details.constraints), 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema parameters or constraints are invalid');
  invariant(Array.isArray(value.output.content) && value.output.content.length === 1, 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema content is invalid');
  invariant(value.output.content[0]?.type === 'text' && typeof value.output.content[0].text === 'string', 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema content is not text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(value.output.content[0].text);
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema content is not JSON');
  }
  invariant(JSON.stringify(contentDetails) === JSON.stringify(details), 'TARGET_GATEWAY_CALENDAR_SCHEMA_INVALID', 'DingTalk Schema content differs from details');
  return {
    digest: details.schemaDigest,
    schema: { parameters: details.parameters, constraints: details.constraints },
  };
}

function createArguments(fixture) {
  return {
    title: fixture.title,
    start: fixture.start,
    end: fixture.end,
    ...(fixture.timezone ? { timezone: fixture.timezone } : {}),
  };
}

function writeArguments(contract, fixture, eventId) {
  if (contract.step === 'create') return createArguments(fixture);
  if (contract.step === 'update') return { event: eventId, title: fixture.updatedTitle };
  return { event: eventId };
}

function assertApprovalPreflight(value, contract) {
  invariant(isRecord(value), 'TARGET_GATEWAY_CALENDAR_APPROVAL_PREFLIGHT_INVALID', 'Calendar approval preflight result must be an object');
  invariant(
    value.ok === false
      && value.toolName === contract.toolName
      && value.requiresApproval === true
      && isRecord(value.error)
      && value.error.code === 'requires_approval',
    'TARGET_GATEWAY_CALENDAR_APPROVAL_PREFLIGHT_INVALID',
    'Calendar write did not stop at the approval boundary',
  );
}

function isApprovalStop(value, contract) {
  return isRecord(value)
    && value.ok === false
    && value.toolName === contract.toolName
    && value.requiresApproval === true
    && isRecord(value.error)
    && value.error.code === 'requires_approval';
}

function assertCalendarWriteInvocation(value, expectedProfile, contract, expectedDigest) {
  invariant(isRecord(value), 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tools.invoke result must be an object');
  invariant(value.ok === true && value.toolName === contract.toolName && value.source === 'plugin', 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tools.invoke did not return the expected plugin result');
  invariant(isRecord(value.output) && isRecord(value.output.details), 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tool details are missing');
  const details = value.output.details;
  invariant(
    details.success === true
      && details.toolName === contract.toolName
      && details.dwsCanonicalPath === contract.canonicalPath
      && details.profileRef === expectedProfile
      && details.schemaDigest === expectedDigest,
    'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN',
    'Calendar tool identity or Schema digest changed during execution',
  );
  invariant(
    typeof details.observedAt === 'string'
      && !Number.isNaN(Date.parse(details.observedAt))
      && new Date(details.observedAt).toISOString() === details.observedAt,
    'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN',
    'Calendar tool observation time is invalid',
  );
  invariant(
    isRecord(details.data)
      && details.data.ok === true
      && details.data.outcome === 'success'
      && Object.hasOwn(details.data, 'data'),
    'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN',
    'Calendar DWS result envelope is invalid',
  );
  invariant(isRecord(details.verification), 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar verification evidence is missing');
  const verification = details.verification;
  invariant(
    verification.status === 'verified'
      && typeof verification.resourceId === 'string'
      && verification.resourceId.trim().length > 0
      && verification.verifierToolName === contract.toolName
      && verification.verifierCanonicalPath === contract.canonicalPath
      && verification.verifierSchemaDigest === expectedDigest,
    'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN',
    'Calendar write was not authoritatively verified',
  );
  invariant(
    typeof verification.observedAt === 'string'
      && !Number.isNaN(Date.parse(verification.observedAt))
      && new Date(verification.observedAt).toISOString() === verification.observedAt,
    'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN',
    'Calendar verification time is invalid',
  );
  invariant(Array.isArray(value.output.content) && value.output.content.length === 1, 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tool text content is invalid');
  invariant(value.output.content[0]?.type === 'text' && typeof value.output.content[0].text === 'string', 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tool content is not text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(value.output.content[0].text);
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tool content is not JSON');
  }
  invariant(JSON.stringify(contentDetails) === JSON.stringify(details), 'TARGET_GATEWAY_CALENDAR_WRITE_UNKNOWN', 'Calendar tool content differs from details');
  return { resourceId: verification.resourceId };
}

function failure(contract, stage, error) {
  return {
    toolName: contract.toolName,
    canonicalPath: contract.canonicalPath,
    stage,
    code: stableDingTalkTargetGatewayFailureCode(error),
  };
}

function evidence(input) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_CALENDAR_CREATE_UPDATE_CANCEL',
    status: input.status,
    state: input.state,
    checkedContractCount: DINGTALK_TARGET_GATEWAY_CALENDAR_CONTRACTS.length,
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
      calendarFixture: false,
      businessPayload: false,
    },
  };
}

export async function runDingTalkTargetGatewayCalendar(options) {
  const input = parseDingTalkTargetGatewayCalendarInput(options.input);
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
  for (const contract of DINGTALK_TARGET_GATEWAY_CALENDAR_WRITE_CONTRACTS) {
    assertDingTalkTargetEffectiveCalendarWriteTool(effective, input.agentId, contract);
  }

  const schemas = new Map();
  const failures = [];
  let schemaVerifiedCount = 0;
  let argumentValidatedCount = 0;
  for (const contract of DINGTALK_TARGET_GATEWAY_CALENDAR_CONTRACTS) {
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
      const verified = assertSchemaInvocation(result, options.schemaToolName, contract);
      schemaVerifiedCount += 1;
      schemas.set(contract.toolName, verified);
      const argumentsValue = contract.effect === 'read'
        ? {}
        : writeArguments(contract, input.fixture, PREFLIGHT_EVENT_ID);
      options.buildSchemaValidatedArguments(verified.schema, argumentsValue);
      argumentValidatedCount += 1;
    } catch (error) {
      failures.push(failure(contract, schemas.has(contract.toolName) ? 'arguments' : 'schema', error));
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
  for (const contract of DINGTALK_TARGET_GATEWAY_CALENDAR_WRITE_CONTRACTS) {
    try {
      const result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: '30000', json: true },
        {
          name: contract.toolName,
          args: {
            profile: input.profile,
            arguments: writeArguments(contract, input.fixture, PREFLIGHT_EVENT_ID),
          },
          sessionKey: input.sessionKey,
          agentId: input.agentId,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
      assertApprovalPreflight(result, contract);
      approvalPreflightCount += 1;
    } catch (error) {
      failures.push(failure(contract, 'approval_preflight', error));
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
      invariant(
        verified.schemaDigest === schemas.get(contract.toolName)?.digest,
        'TARGET_GATEWAY_CALENDAR_SCHEMA_CHANGED',
        'DingTalk Schema changed between preflight and core read',
      );
      readPassedCount += 1;
    } catch (error) {
      failures.push(failure(contract, 'readonly_preflight', error));
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
  let eventId;
  let writeRequestCount = 0;
  for (const contract of DINGTALK_TARGET_GATEWAY_CALENDAR_WRITE_CONTRACTS) {
    const argumentsValue = writeArguments(contract, input.fixture, eventId);
    writeRequestCount += 1;
    let result;
    try {
      result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: WRITE_TIMEOUT, json: true },
        {
          name: contract.toolName,
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
        failedStage: contract.step,
        ...(eventId ? { resourceId: eventId } : {}),
        failures: [failure(contract, 'write', error)],
        recovery: eventId
          ? 'inspect_exact_event_before_any_action'
          : 'inspect_by_unique_title_before_any_retry',
      });
    }
    if (isApprovalStop(result, contract)) {
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
        failedStage: contract.step,
        ...(eventId ? { resourceId: eventId } : {}),
        failures: [failure(contract, 'approval', new DingTalkTargetGatewayReadFailure(
          'TARGET_GATEWAY_CALENDAR_APPROVAL_NOT_GRANTED',
          'Calendar approval was not granted',
        ))],
        recovery: eventId
          ? 'inspect_exact_event_before_any_action'
          : 'request_fresh_approval_before_retry',
      });
    }
    let verified;
    try {
      verified = assertCalendarWriteInvocation(
        result,
        input.profile,
        contract,
        schemas.get(contract.toolName)?.digest,
      );
      if (eventId) {
        invariant(
          verified.resourceId === eventId,
          'TARGET_GATEWAY_CALENDAR_RESOURCE_MISMATCH',
          'Calendar write returned a different eventId',
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
        failedStage: contract.step,
        ...(eventId ? { resourceId: eventId } : {}),
        failures: [failure(contract, 'write_verification', error)],
        recovery: eventId
          ? 'inspect_exact_event_before_any_action'
          : 'inspect_by_unique_title_before_any_retry',
      });
    }
    eventId = verified.resourceId;
    completedSteps.push(contract.step);
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
    resourceIdSha256: createHash('sha256').update(eventId).digest('hex'),
    failures: [],
    recovery: 'none',
  });
}

export function serializeDingTalkTargetGatewayCalendarFailure(error) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_CALENDAR_CREATE_UPDATE_CANCEL',
    status: 'FAILED',
    code: stableDingTalkTargetGatewayFailureCode(error),
  };
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === SCRIPT_PATH) {
  try {
    const args = parseDingTalkTargetGatewayCalendarArguments(process.argv.slice(2));
    const input = await readDingTalkTargetGatewayCalendarInput(process.stdin);
    const gatewayToken = validateDingTalkTargetGatewayToken(process.env.OPENCLAW_GATEWAY_TOKEN);
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const [openClawRuntime, dingtalkRuntime] = await Promise.all([
      resolveOpenClawGatewayRuntime(args.packageJsonPath),
      resolveDingTalkCalendarVerifierRuntime(args.dingtalkPackageJsonPath),
    ]);
    const result = await runDingTalkTargetGatewayCalendar({
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
    console.error(JSON.stringify(serializeDingTalkTargetGatewayCalendarFailure(error)));
    process.exitCode = 1;
  }
}
