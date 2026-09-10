#!/usr/bin/env node

import { realpath } from 'node:fs/promises';

import {
  DINGTALK_TARGET_GATEWAY_READ_PLUGIN,
  DingTalkTargetGatewayReadFailure,
  assertDingTalkTargetEffectiveReadToolContract,
  assertDingTalkTargetReadInvocationContract,
  parseDingTalkTargetGatewayConnection,
  parseDingTalkTargetGatewayReadInput,
  readDingTalkTargetGatewayReadInput,
  resolveOpenClawGatewayRuntime,
  validateDingTalkTargetGatewayToken,
} from './verify-dingtalk-target-gateway-read.mjs';

const SCRIPT_PATH = await realpath(new URL(import.meta.url));

export const DINGTALK_TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT = 'JUNQI_DINGTALK_TARGET_GATEWAY_READONLY_MATRIX';

const CORE_CONTRACTS = [
  { toolName: 'junqi_dingtalk_contact_me', canonicalPath: 'contact.get_current_user_profile' },
  { toolName: 'junqi_dingtalk_calendar_today', canonicalPath: 'calendar.shortcut_today' },
  { toolName: 'junqi_dingtalk_todo_overdue', canonicalPath: 'todo.shortcut_overdue' },
  { toolName: 'junqi_dingtalk_todo_due_today', canonicalPath: 'todo.shortcut_due_today' },
  { toolName: 'junqi_dingtalk_approval_pending', canonicalPath: 'oa.list_pending_approvals' },
];

export const DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE = {
  core: CORE_CONTRACTS,
  extended: [
    ...CORE_CONTRACTS,
    { toolName: 'junqi_dingtalk_minutes_latest', canonicalPath: 'minutes.shortcut_latest' },
    { toolName: 'junqi_dingtalk_wiki_spaces', canonicalPath: 'wiki.shortcut_space_list' },
    { toolName: 'junqi_dingtalk_report_latest', canonicalPath: 'report.shortcut_report_latest' },
    { toolName: 'junqi_dingtalk_mail_triage', canonicalPath: 'mail.shortcut_triage' },
    { toolName: 'junqi_dingtalk_chat_unread', canonicalPath: 'chat.shortcut_unread_chats' },
    { toolName: 'junqi_dingtalk_recruit_jobs', canonicalPath: 'recruit.list_jobs' },
    { toolName: 'junqi_dingtalk_goal_user_rules', canonicalPath: 'agoal.shortcut_user_rules' },
  ],
};

function invariant(condition, code, message) {
  if (!condition) throw new DingTalkTargetGatewayReadFailure(code, message);
}

export function parseDingTalkTargetGatewayReadonlyArguments(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  invariant(normalized.length % 2 === 0, 'TARGET_GATEWAY_READONLY_ARGUMENTS_INVALID', 'Every flag requires one value');
  const values = new Map();
  const supported = new Set([
    '--gateway-url',
    '--openclaw-package',
    '--scope',
    '--acknowledge-target-readonly',
  ]);
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index];
    const value = normalized[index + 1];
    invariant(supported.has(flag), 'TARGET_GATEWAY_READONLY_ARGUMENTS_INVALID', 'Unsupported target Gateway readonly argument');
    invariant(!values.has(flag), 'TARGET_GATEWAY_READONLY_ARGUMENTS_INVALID', 'Duplicate target Gateway readonly argument');
    invariant(typeof value === 'string' && value.length > 0, 'TARGET_GATEWAY_READONLY_ARGUMENTS_INVALID', 'Target Gateway readonly argument value is missing');
    values.set(flag, value);
  }
  invariant(values.size === supported.size, 'TARGET_GATEWAY_READONLY_ARGUMENTS_INVALID', 'Target Gateway readonly arguments are incomplete');
  invariant(
    values.get('--acknowledge-target-readonly') === DINGTALK_TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT,
    'TARGET_GATEWAY_READONLY_ACKNOWLEDGEMENT_INVALID',
    'Target Gateway readonly acknowledgement is invalid',
  );
  const scope = values.get('--scope');
  invariant(scope === 'core' || scope === 'extended', 'TARGET_GATEWAY_READONLY_SCOPE_INVALID', 'Target Gateway readonly scope must be core or extended');
  return {
    ...parseDingTalkTargetGatewayConnection(
      values.get('--gateway-url'),
      values.get('--openclaw-package'),
    ),
    scope,
  };
}

export function stableDingTalkTargetGatewayFailureCode(error) {
  if (error instanceof DingTalkTargetGatewayReadFailure) return error.code;
  if (
    error instanceof Error
    && error.name === 'GatewayClientRequestError'
    && typeof error.gatewayCode === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.gatewayCode)
  ) {
    const detailCode = error.details?.code;
    return typeof detailCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(detailCode)
      ? `GATEWAY_${error.gatewayCode}_${detailCode}`
      : `GATEWAY_${error.gatewayCode}`;
  }
  return 'TARGET_GATEWAY_READONLY_TOOL_FAILED';
}

export async function runDingTalkTargetGatewayReadonly(options) {
  const input = parseDingTalkTargetGatewayReadInput(options.input);
  const token = validateDingTalkTargetGatewayToken(options.gatewayToken);
  const contracts = DINGTALK_TARGET_GATEWAY_READONLY_CONTRACTS_BY_SCOPE[options.scope];
  invariant(Array.isArray(contracts), 'TARGET_GATEWAY_READONLY_SCOPE_INVALID', 'Target Gateway readonly scope must be core or extended');
  const effective = await options.callGatewayFromCli(
    'tools.effective',
    { url: options.gatewayUrl, token, timeout: '30000', json: true },
    { sessionKey: input.sessionKey, agentId: input.agentId },
    { deviceIdentity: null, progress: false, scopes: ['operator.read'], sharedStateMode: 'read-only' },
  );
  const projected = contracts.map((contract) =>
    assertDingTalkTargetEffectiveReadToolContract(effective, input.agentId, contract));
  invariant(
    projected.every((entry) => entry.pluginId === DINGTALK_TARGET_GATEWAY_READ_PLUGIN),
    'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID',
    'Target Gateway readonly tools have an unexpected plugin owner',
  );

  const passed = [];
  const failures = [];
  for (const contract of contracts) {
    try {
      const invocation = await options.callGatewayFromCli(
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
      const verified = assertDingTalkTargetReadInvocationContract(
        invocation,
        input.profile,
        contract,
      );
      passed.push({
        toolName: contract.toolName,
        canonicalPath: contract.canonicalPath,
        schemaDigest: verified.schemaDigest,
      });
    } catch (error) {
      failures.push({
        toolName: contract.toolName,
        canonicalPath: contract.canonicalPath,
        code: stableDingTalkTargetGatewayFailureCode(error),
      });
    }
  }

  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_READONLY_MATRIX',
    status: failures.length === 0 ? 'PASSED' : 'FAILED',
    scope: options.scope,
    checkedCount: contracts.length,
    passedCount: passed.length,
    failedCount: failures.length,
    passed,
    failures,
    scopes: {
      effectiveTools: ['operator.read'],
      toolInvocation: ['operator.write'],
    },
    retained: {
      gatewayToken: false,
      sessionKey: false,
      profileRef: false,
      businessPayload: false,
    },
  };
}

export function serializeDingTalkTargetGatewayReadonlyFailure(error) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_READONLY_MATRIX',
    status: 'FAILED',
    code: stableDingTalkTargetGatewayFailureCode(error),
  };
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === SCRIPT_PATH) {
  try {
    const args = parseDingTalkTargetGatewayReadonlyArguments(process.argv.slice(2));
    const input = await readDingTalkTargetGatewayReadInput(process.stdin);
    const gatewayToken = validateDingTalkTargetGatewayToken(process.env.OPENCLAW_GATEWAY_TOKEN);
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const runtime = await resolveOpenClawGatewayRuntime(args.packageJsonPath);
    const result = await runDingTalkTargetGatewayReadonly({
      callGatewayFromCli: runtime.callGatewayFromCli,
      gatewayUrl: args.gatewayUrl,
      gatewayToken,
      input,
      scope: args.scope,
    });
    console.log(JSON.stringify({
      ...result,
      openClawPackageVersion: runtime.packageVersion,
    }, null, 2));
    if (result.status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(serializeDingTalkTargetGatewayReadonlyFailure(error)));
    process.exitCode = 1;
  }
}
