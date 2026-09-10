#!/usr/bin/env node

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
import { stableDingTalkTargetGatewayFailureCode } from './verify-dingtalk-target-gateway-readonly.mjs';

const SCRIPT_PATH = await realpath(new URL(import.meta.url));
const INPUT_LIMIT_BYTES = 1_048_576;

export const DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_ACKNOWLEDGEMENT =
  'JUNQI_DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_17';

export const DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS = [
  { toolName: 'junqi_dingtalk_aitable_base_search', canonicalPath: 'aitable.shortcut_base_search' },
  { toolName: 'junqi_dingtalk_aitable_schema', canonicalPath: 'aitable.shortcut_base_schema_snapshot' },
  { toolName: 'junqi_dingtalk_aitable_tables', canonicalPath: 'aitable.shortcut_list_tables' },
  { toolName: 'junqi_dingtalk_aitable_records', canonicalPath: 'aitable.shortcut_record_query' },
  { toolName: 'junqi_dingtalk_contract_projects', canonicalPath: 'contract.project_list' },
  { toolName: 'junqi_dingtalk_contract_project', canonicalPath: 'contract.project_detail' },
  { toolName: 'junqi_dingtalk_contract_subjects', canonicalPath: 'contract.subject_list' },
  { toolName: 'junqi_dingtalk_contract_subject', canonicalPath: 'contract.subject_detail' },
  { toolName: 'junqi_dingtalk_contract_risk', canonicalPath: 'contract.subject_detect_risk' },
  { toolName: 'junqi_dingtalk_contract_review_analysis', canonicalPath: 'contract.review_analysis' },
  { toolName: 'junqi_dingtalk_contract_review_result', canonicalPath: 'contract.review_result' },
  { toolName: 'junqi_dingtalk_recruit_jobs', canonicalPath: 'recruit.list_jobs' },
  { toolName: 'junqi_dingtalk_recruit_job', canonicalPath: 'recruit.get_job_detail' },
  { toolName: 'junqi_dingtalk_goal_user_rules', canonicalPath: 'agoal.shortcut_user_rules' },
  { toolName: 'junqi_dingtalk_goal_templates', canonicalPath: 'agoal.shortcut_obj_template_list' },
  { toolName: 'junqi_dingtalk_goal_statistics', canonicalPath: 'agoal.shortcut_report_statistics_list' },
  { toolName: 'junqi_dingtalk_goal_report_detail', canonicalPath: 'agoal.shortcut_report_submit_detail' },
];

function invariant(condition, code, message) {
  if (!condition) throw new DingTalkTargetGatewayReadFailure(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function parseDingTalkTargetGatewaySensitiveReadonlyArguments(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  invariant(normalized.length % 2 === 0, 'TARGET_GATEWAY_SENSITIVE_ARGUMENTS_INVALID', 'Every flag requires one value');
  const values = new Map();
  const supported = new Set([
    '--gateway-url',
    '--openclaw-package',
    '--dingtalk-package',
    '--acknowledge-target-sensitive-readonly',
  ]);
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index];
    const value = normalized[index + 1];
    invariant(supported.has(flag), 'TARGET_GATEWAY_SENSITIVE_ARGUMENTS_INVALID', 'Unsupported target Gateway sensitive-read argument');
    invariant(!values.has(flag), 'TARGET_GATEWAY_SENSITIVE_ARGUMENTS_INVALID', 'Duplicate target Gateway sensitive-read argument');
    invariant(typeof value === 'string' && value.length > 0, 'TARGET_GATEWAY_SENSITIVE_ARGUMENTS_INVALID', 'Target Gateway sensitive-read argument value is missing');
    values.set(flag, value);
  }
  invariant(values.size === supported.size, 'TARGET_GATEWAY_SENSITIVE_ARGUMENTS_INVALID', 'Target Gateway sensitive-read arguments are incomplete');
  invariant(
    values.get('--acknowledge-target-sensitive-readonly')
      === DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_ACKNOWLEDGEMENT,
    'TARGET_GATEWAY_SENSITIVE_ACKNOWLEDGEMENT_INVALID',
    'Target Gateway sensitive-read acknowledgement is invalid',
  );
  const dingtalkPackageJsonPath = values.get('--dingtalk-package');
  invariant(path.isAbsolute(dingtalkPackageJsonPath), 'DINGTALK_PACKAGE_PATH_INVALID', 'DingTalk package.json path must be absolute');
  return {
    ...parseDingTalkTargetGatewayConnection(
      values.get('--gateway-url'),
      values.get('--openclaw-package'),
    ),
    dingtalkPackageJsonPath: path.normalize(dingtalkPackageJsonPath),
  };
}

export async function readDingTalkTargetGatewaySensitiveReadonlyInput(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    invariant(bytes <= INPUT_LIMIT_BYTES, 'TARGET_GATEWAY_SENSITIVE_INPUT_TOO_LARGE', 'Target Gateway sensitive-read input exceeds 1 MiB');
    chunks.push(buffer);
  }
  invariant(bytes > 0, 'TARGET_GATEWAY_SENSITIVE_INPUT_REQUIRED', 'Target Gateway sensitive-read input is required');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_SENSITIVE_INPUT_INVALID', 'Target Gateway sensitive-read input must be JSON');
  }
}

export function parseDingTalkTargetGatewaySensitiveReadonlyInput(value, parseFixture) {
  invariant(isRecord(value), 'TARGET_GATEWAY_SENSITIVE_INPUT_INVALID', 'Target Gateway sensitive-read input must be an object');
  const expectedKeys = new Set(['agentId', 'sessionKey', 'profile', 'fixture']);
  invariant(
    Object.keys(value).length === expectedKeys.size
      && Object.keys(value).every((key) => expectedKeys.has(key)),
    'TARGET_GATEWAY_SENSITIVE_INPUT_INVALID',
    'Target Gateway sensitive-read input fields are invalid',
  );
  const connection = parseDingTalkTargetGatewayReadInput({
    agentId: value.agentId,
    sessionKey: value.sessionKey,
    profile: value.profile,
  });
  return {
    ...connection,
    fixture: parseFixture(value.fixture),
  };
}

export async function resolveDingTalkSensitiveVerifierRuntime(packageJsonPath) {
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
  const moduleNames = [
    'target-sensitive-readonly-preflight.js',
    'schema-contract.js',
    'tool-specs.js',
  ];
  const modulePaths = [];
  for (const moduleName of moduleNames) {
    const unresolved = path.resolve(packageRoot, 'dist', moduleName);
    invariant(containedPath(packageRoot, unresolved), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module escapes the package');
    const resolved = await realpath(unresolved).catch(() => null);
    invariant(resolved !== null && containedPath(packageRoot, resolved), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module is unavailable');
    const moduleStats = await stat(resolved).catch(() => null);
    invariant(moduleStats?.isFile(), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module is not a regular file');
    modulePaths.push(resolved);
  }
  const [sensitiveModule, schemaModule, toolSpecsModule] = await Promise.all(
    modulePaths.map((modulePath) => import(pathToFileURL(modulePath).href)),
  );
  invariant(typeof sensitiveModule.parseDingTalkTargetSensitiveReadonlyFixture === 'function', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier fixture parser is missing');
  invariant(typeof sensitiveModule.buildDingTalkTargetSensitiveToolInvocations === 'function', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier plan builder is missing');
  invariant(typeof schemaModule.buildSchemaValidatedArguments === 'function', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier argument validator is missing');
  invariant(typeof toolSpecsModule.TOOL_SCHEMA_TOOL_NAME === 'string', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier Schema tool identity is missing');
  return {
    packageVersion: typeof packageDocument.version === 'string' ? packageDocument.version : null,
    parseFixture: sensitiveModule.parseDingTalkTargetSensitiveReadonlyFixture,
    buildInvocations: sensitiveModule.buildDingTalkTargetSensitiveToolInvocations,
    buildSchemaValidatedArguments: schemaModule.buildSchemaValidatedArguments,
    schemaToolName: toolSpecsModule.TOOL_SCHEMA_TOOL_NAME,
  };
}

export function assertDingTalkTargetSensitiveSchemaInvocation(value, schemaToolName, invocation) {
  invariant(isRecord(value), 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation result must be an object');
  invariant(value.ok === true && value.toolName === schemaToolName && value.source === 'plugin', 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation identity is invalid');
  invariant(isRecord(value.output), 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation output is missing');
  const details = value.output.details;
  invariant(isRecord(details), 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation details are missing');
  invariant(details.success === true, 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation did not succeed');
  invariant(details.toolName === invocation.toolName, 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation returned the wrong tool');
  invariant(details.dwsCanonicalPath === invocation.canonicalPath, 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation returned the wrong canonical path');
  invariant(typeof details.schemaDigest === 'string' && /^[a-f0-9]{64}$/.test(details.schemaDigest), 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation returned an invalid digest');
  invariant(
    details.effect === 'read'
      && details.risk === 'low'
      && details.confirmation === 'not_required'
      && details.idempotency === 'idempotent',
    'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID',
    'DingTalk Schema invocation returned an unsafe contract',
  );
  invariant(isRecord(details.parameters) && isRecord(details.constraints), 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation returned invalid parameters or constraints');
  invariant(Array.isArray(value.output.content) && value.output.content.length === 1, 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation content is invalid');
  invariant(value.output.content[0]?.type === 'text' && typeof value.output.content[0].text === 'string', 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation content is not text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(value.output.content[0].text);
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation content is not JSON');
  }
  invariant(JSON.stringify(contentDetails) === JSON.stringify(details), 'TARGET_GATEWAY_SENSITIVE_SCHEMA_INVALID', 'DingTalk Schema invocation content differs from details');
  return {
    schemaDigest: details.schemaDigest,
    schema: {
      parameters: details.parameters,
      constraints: details.constraints,
    },
  };
}

function matrixResult(invocations, schemaVerifiedCount, argumentValidatedCount, readAttemptedCount, passed, failures) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_17',
    status: failures.length === 0 ? 'PASSED' : 'FAILED',
    checkedCount: invocations.length,
    schemaVerifiedCount,
    argumentValidatedCount,
    readAttemptedCount,
    passedCount: passed.length,
    failedCount: failures.length,
    unattemptedCount: invocations.length - passed.length - failures.length,
    passed,
    failures,
    scopes: {
      effectiveTools: ['operator.read'],
      schemaInvocation: ['operator.write'],
      toolInvocation: ['operator.write'],
    },
    retained: {
      gatewayToken: false,
      sessionKey: false,
      profileRef: false,
      fixture: false,
      businessPayload: false,
    },
  };
}

export async function runDingTalkTargetGatewaySensitiveReadonly(options) {
  const token = validateDingTalkTargetGatewayToken(options.gatewayToken);
  const invocations = options.buildInvocations(options.input.fixture);
  invariant(
    Array.isArray(invocations)
      && invocations.length === DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS.length
      && invocations.every((entry, index) => (
        isRecord(entry)
        && entry.toolName === DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS[index].toolName
        && entry.canonicalPath === DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_CONTRACTS[index].canonicalPath
        && isRecord(entry.arguments)
        && isRecord(entry.schemaArguments)
      )),
    'TARGET_GATEWAY_SENSITIVE_PLAN_INVALID',
    'Target Gateway sensitive-read plan differs from the fixed 17-tool contract',
  );
  const effective = await options.callGatewayFromCli(
    'tools.effective',
    { url: options.gatewayUrl, token, timeout: '30000', json: true },
    { sessionKey: options.input.sessionKey, agentId: options.input.agentId },
    { deviceIdentity: null, progress: false, scopes: ['operator.read'], sharedStateMode: 'read-only' },
  );
  const projectedContracts = [
    { toolName: options.schemaToolName },
    ...invocations,
  ];
  const projected = projectedContracts.map((contract) => (
    assertDingTalkTargetEffectiveReadToolContract(effective, options.input.agentId, contract)
  ));
  invariant(
    projected.every((entry) => entry.pluginId === DINGTALK_TARGET_GATEWAY_READ_PLUGIN),
    'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID',
    'Target Gateway sensitive-read tools have an unexpected plugin owner',
  );

  const schemasByToolName = new Map();
  const failures = [];
  let schemaVerifiedCount = 0;
  let argumentValidatedCount = 0;
  for (const invocation of invocations) {
    try {
      const schemaInvocation = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: '30000', json: true },
        {
          name: options.schemaToolName,
          args: { toolName: invocation.toolName },
          sessionKey: options.input.sessionKey,
          agentId: options.input.agentId,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
      const verified = assertDingTalkTargetSensitiveSchemaInvocation(
        schemaInvocation,
        options.schemaToolName,
        invocation,
      );
      schemaVerifiedCount += 1;
      schemasByToolName.set(invocation.toolName, verified.schemaDigest);
      options.buildSchemaValidatedArguments(verified.schema, invocation.schemaArguments);
      argumentValidatedCount += 1;
    } catch (error) {
      failures.push({
        toolName: invocation.toolName,
        canonicalPath: invocation.canonicalPath,
        stage: schemasByToolName.has(invocation.toolName) ? 'arguments' : 'schema',
        code: stableDingTalkTargetGatewayFailureCode(error),
      });
    }
  }
  if (failures.length > 0) {
    return matrixResult(
      invocations,
      schemaVerifiedCount,
      argumentValidatedCount,
      0,
      [],
      failures,
    );
  }

  const passed = [];
  for (const invocation of invocations) {
    try {
      const result = await options.callGatewayFromCli(
        'tools.invoke',
        { url: options.gatewayUrl, token, timeout: '30000', json: true },
        {
          name: invocation.toolName,
          args: { profile: options.input.profile, arguments: invocation.arguments },
          sessionKey: options.input.sessionKey,
          agentId: options.input.agentId,
        },
        { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
      );
      const verified = assertDingTalkTargetReadInvocationContract(
        result,
        options.input.profile,
        invocation,
      );
      invariant(
        verified.schemaDigest === schemasByToolName.get(invocation.toolName),
        'TARGET_GATEWAY_SENSITIVE_SCHEMA_CHANGED',
        'DingTalk Schema digest changed between preflight and read',
      );
      passed.push({
        toolName: invocation.toolName,
        canonicalPath: invocation.canonicalPath,
        schemaDigest: verified.schemaDigest,
      });
    } catch (error) {
      failures.push({
        toolName: invocation.toolName,
        canonicalPath: invocation.canonicalPath,
        stage: 'read',
        code: stableDingTalkTargetGatewayFailureCode(error),
      });
    }
  }
  return matrixResult(
    invocations,
    schemaVerifiedCount,
    argumentValidatedCount,
    invocations.length,
    passed,
    failures,
  );
}

export function serializeDingTalkTargetGatewaySensitiveReadonlyFailure(error) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_SENSITIVE_READONLY_17',
    status: 'FAILED',
    code: stableDingTalkTargetGatewayFailureCode(error),
  };
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === SCRIPT_PATH) {
  try {
    const args = parseDingTalkTargetGatewaySensitiveReadonlyArguments(process.argv.slice(2));
    const inputDocument = await readDingTalkTargetGatewaySensitiveReadonlyInput(process.stdin);
    const gatewayToken = validateDingTalkTargetGatewayToken(process.env.OPENCLAW_GATEWAY_TOKEN);
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const [openClawRuntime, dingtalkRuntime] = await Promise.all([
      resolveOpenClawGatewayRuntime(args.packageJsonPath),
      resolveDingTalkSensitiveVerifierRuntime(args.dingtalkPackageJsonPath),
    ]);
    const input = parseDingTalkTargetGatewaySensitiveReadonlyInput(
      inputDocument,
      dingtalkRuntime.parseFixture,
    );
    const result = await runDingTalkTargetGatewaySensitiveReadonly({
      callGatewayFromCli: openClawRuntime.callGatewayFromCli,
      gatewayUrl: args.gatewayUrl,
      gatewayToken,
      input,
      buildInvocations: dingtalkRuntime.buildInvocations,
      buildSchemaValidatedArguments: dingtalkRuntime.buildSchemaValidatedArguments,
      schemaToolName: dingtalkRuntime.schemaToolName,
    });
    console.log(JSON.stringify({
      ...result,
      openClawPackageVersion: openClawRuntime.packageVersion,
      dingtalkPackageVersion: dingtalkRuntime.packageVersion,
    }, null, 2));
    if (result.status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(serializeDingTalkTargetGatewaySensitiveReadonlyFailure(error)));
    process.exitCode = 1;
  }
}
