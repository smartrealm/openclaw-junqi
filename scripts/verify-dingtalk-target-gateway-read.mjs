#!/usr/bin/env node

import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SCRIPT_PATH = await realpath(new URL(import.meta.url));

export const DINGTALK_TARGET_GATEWAY_READ_ACKNOWLEDGEMENT = 'JUNQI_DINGTALK_TARGET_GATEWAY_CURRENT_USER_READ';
export const DINGTALK_TARGET_GATEWAY_READ_TOOL = 'junqi_dingtalk_contact_me';
export const DINGTALK_TARGET_GATEWAY_READ_PLUGIN = 'junqi-dingtalk';
export const DINGTALK_TARGET_GATEWAY_READ_CANONICAL_PATH = 'contact.get_current_user_profile';
export const DINGTALK_TARGET_GATEWAY_READ_INPUT_LIMIT = 4_096;

export class DingTalkTargetGatewayReadFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DingTalkTargetGatewayReadFailure';
    this.code = code;
  }
}

function invariant(condition, code, message) {
  if (!condition) throw new DingTalkTargetGatewayReadFailure(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedBoundedString(value, field, maximumLength) {
  invariant(typeof value === 'string', 'TARGET_GATEWAY_READ_INPUT_INVALID', `${field} must be a string`);
  const normalized = value.trim();
  invariant(normalized.length > 0, 'TARGET_GATEWAY_READ_INPUT_INVALID', `${field} must not be empty`);
  invariant(normalized.length <= maximumLength, 'TARGET_GATEWAY_READ_INPUT_INVALID', `${field} is too long`);
  invariant(!/[\r\n\0]/.test(normalized), 'TARGET_GATEWAY_READ_INPUT_INVALID', `${field} contains forbidden characters`);
  return normalized;
}

function assertClosedKeys(value, expectedKeys, code, label) {
  const actual = Object.keys(value).sort();
  invariant(
    JSON.stringify(actual) === JSON.stringify([...expectedKeys].sort()),
    code,
    `${label} fields do not match the closed contract`,
  );
}

export function parseDingTalkTargetGatewayConnection(gatewayUrlValue, packageJsonInput) {
  let gatewayUrl;
  try {
    gatewayUrl = new URL(gatewayUrlValue);
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_URL_INVALID', 'Gateway URL is invalid');
  }
  invariant(gatewayUrl.protocol === 'ws:' || gatewayUrl.protocol === 'wss:', 'TARGET_GATEWAY_URL_INVALID', 'Gateway URL must use ws or wss');
  invariant(gatewayUrl.hostname.length > 0, 'TARGET_GATEWAY_URL_INVALID', 'Gateway URL hostname is missing');
  invariant(gatewayUrl.username === '' && gatewayUrl.password === '', 'TARGET_GATEWAY_URL_INVALID', 'Gateway URL must not contain credentials');
  invariant(gatewayUrl.search === '' && gatewayUrl.hash === '', 'TARGET_GATEWAY_URL_INVALID', 'Gateway URL must not contain query or fragment data');
  invariant(gatewayUrl.pathname === '/', 'TARGET_GATEWAY_URL_INVALID', 'Gateway URL must use the root WebSocket path');
  invariant(typeof packageJsonInput === 'string' && path.isAbsolute(packageJsonInput), 'OPENCLAW_PACKAGE_PATH_INVALID', 'OpenClaw package path must be absolute');
  const packageJsonPath = path.resolve(packageJsonInput);
  invariant(path.basename(packageJsonPath) === 'package.json', 'OPENCLAW_PACKAGE_PATH_INVALID', 'OpenClaw package path must identify package.json');
  return {
    gatewayUrl: gatewayUrl.toString(),
    packageJsonPath,
  };
}

export function validateDingTalkTargetGatewayToken(value) {
  return normalizedBoundedString(value, 'OPENCLAW_GATEWAY_TOKEN', 8_192);
}

export function parseDingTalkTargetGatewayReadArguments(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  invariant(normalized.length % 2 === 0, 'TARGET_GATEWAY_READ_ARGUMENTS_INVALID', 'Every flag requires one value');
  const values = new Map();
  const supported = new Set([
    '--gateway-url',
    '--openclaw-package',
    '--acknowledge-target-read',
  ]);
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index];
    const value = normalized[index + 1];
    invariant(supported.has(flag), 'TARGET_GATEWAY_READ_ARGUMENTS_INVALID', 'Unsupported target Gateway read argument');
    invariant(!values.has(flag), 'TARGET_GATEWAY_READ_ARGUMENTS_INVALID', 'Duplicate target Gateway read argument');
    invariant(typeof value === 'string' && value.length > 0, 'TARGET_GATEWAY_READ_ARGUMENTS_INVALID', 'Target Gateway read argument value is missing');
    values.set(flag, value);
  }
  invariant(values.size === supported.size, 'TARGET_GATEWAY_READ_ARGUMENTS_INVALID', 'Target Gateway read arguments are incomplete');

  const acknowledgement = values.get('--acknowledge-target-read');
  invariant(
    acknowledgement === DINGTALK_TARGET_GATEWAY_READ_ACKNOWLEDGEMENT,
    'TARGET_GATEWAY_READ_ACKNOWLEDGEMENT_INVALID',
    'Target Gateway current-user read acknowledgement is invalid',
  );

  return parseDingTalkTargetGatewayConnection(
    values.get('--gateway-url'),
    values.get('--openclaw-package'),
  );
}

export function parseDingTalkTargetGatewayReadInput(value) {
  invariant(isRecord(value), 'TARGET_GATEWAY_READ_INPUT_INVALID', 'Target Gateway read input must be an object');
  assertClosedKeys(
    value,
    ['agentId', 'profile', 'sessionKey'],
    'TARGET_GATEWAY_READ_INPUT_INVALID',
    'Target Gateway read input',
  );
  const agentId = normalizedBoundedString(value.agentId, 'agentId', 128);
  const sessionKey = normalizedBoundedString(value.sessionKey, 'sessionKey', 512);
  const profile = normalizedBoundedString(value.profile, 'profile', 512);
  invariant(/^[^:\s]+:[^:\s]+$/.test(profile), 'TARGET_GATEWAY_READ_INPUT_INVALID', 'profile must use the exact <corpId>:<userId> form');
  return { agentId, sessionKey, profile };
}

export async function readDingTalkTargetGatewayReadInput(inputStream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of inputStream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    invariant(bytes <= DINGTALK_TARGET_GATEWAY_READ_INPUT_LIMIT, 'TARGET_GATEWAY_READ_INPUT_TOO_LARGE', 'Target Gateway read stdin exceeds 4 KiB');
    chunks.push(buffer);
  }
  invariant(bytes > 0, 'TARGET_GATEWAY_READ_INPUT_INVALID', 'Target Gateway read JSON is required on stdin');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_READ_INPUT_INVALID', 'Target Gateway read stdin must be valid JSON');
  }
  return parseDingTalkTargetGatewayReadInput(parsed);
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveOpenClawGatewayRuntime(packageJsonInput) {
  const resolvedPackageJson = await realpath(packageJsonInput).catch(() => null);
  invariant(resolvedPackageJson !== null, 'OPENCLAW_PACKAGE_INVALID', 'OpenClaw package.json is unavailable');
  invariant(path.basename(resolvedPackageJson) === 'package.json', 'OPENCLAW_PACKAGE_INVALID', 'Resolved OpenClaw package path is not package.json');
  const packageRoot = path.dirname(resolvedPackageJson);
  let packageDocument;
  try {
    packageDocument = JSON.parse(await readFile(resolvedPackageJson, 'utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('OPENCLAW_PACKAGE_INVALID', 'OpenClaw package.json is invalid');
  }
  invariant(isRecord(packageDocument) && packageDocument.name === 'openclaw', 'OPENCLAW_PACKAGE_INVALID', 'Target package is not OpenClaw');
  const gatewayExport = packageDocument.exports?.['./plugin-sdk/gateway-runtime'];
  invariant(
    isRecord(gatewayExport) && typeof gatewayExport.default === 'string',
    'OPENCLAW_GATEWAY_RUNTIME_EXPORT_MISSING',
    'OpenClaw package does not export plugin-sdk/gateway-runtime',
  );
  invariant(gatewayExport.default.startsWith('./'), 'OPENCLAW_GATEWAY_RUNTIME_EXPORT_INVALID', 'OpenClaw Gateway runtime export must be package-relative');
  const unresolvedRuntimePath = path.resolve(packageRoot, gatewayExport.default);
  invariant(containedPath(packageRoot, unresolvedRuntimePath), 'OPENCLAW_GATEWAY_RUNTIME_EXPORT_INVALID', 'OpenClaw Gateway runtime export escapes the package');
  const runtimePath = await realpath(unresolvedRuntimePath).catch(() => null);
  invariant(runtimePath !== null && containedPath(packageRoot, runtimePath), 'OPENCLAW_GATEWAY_RUNTIME_EXPORT_INVALID', 'OpenClaw Gateway runtime export is unavailable');
  const runtimeStats = await stat(runtimePath).catch(() => null);
  invariant(runtimeStats?.isFile(), 'OPENCLAW_GATEWAY_RUNTIME_EXPORT_INVALID', 'OpenClaw Gateway runtime export is not a regular file');
  const runtimeModule = await import(pathToFileURL(runtimePath).href);
  invariant(typeof runtimeModule.callGatewayFromCli === 'function', 'OPENCLAW_GATEWAY_RUNTIME_EXPORT_INVALID', 'OpenClaw Gateway runtime does not export callGatewayFromCli');
  return {
    callGatewayFromCli: runtimeModule.callGatewayFromCli,
    packageVersion: typeof packageDocument.version === 'string' ? packageDocument.version : null,
  };
}

export function assertDingTalkTargetEffectiveReadToolContract(value, expectedAgentId, contract) {
  invariant(isRecord(value), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory must be an object');
  invariant(value.agentId === expectedAgentId, 'TARGET_GATEWAY_AGENT_MISMATCH', 'Effective tool inventory resolved a different Agent');
  invariant(typeof value.profile === 'string' && value.profile.length > 0, 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory profile is missing');
  invariant(Array.isArray(value.groups), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory groups are missing');
  const matches = value.groups
    .filter((group) => isRecord(group) && group.source === 'plugin' && Array.isArray(group.tools))
    .flatMap((group) => group.tools)
    .filter((tool) => isRecord(tool) && tool.id === contract.toolName);
  invariant(matches.length === 1, 'TARGET_GATEWAY_DINGTALK_TOOL_MISSING', 'Effective inventory must contain exactly one expected DingTalk read tool');
  const tool = matches[0];
  invariant(tool.source === 'plugin', 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk current-user tool has the wrong source');
  invariant(tool.pluginId === DINGTALK_TARGET_GATEWAY_READ_PLUGIN, 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk current-user tool has the wrong plugin owner');
  invariant(tool.deniedBySession !== true, 'TARGET_GATEWAY_DINGTALK_TOOL_DENIED', 'DingTalk current-user tool is denied by the target Session');
  invariant(tool.risk === 'low', 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk read tool risk is not low');
  invariant(Array.isArray(tool.tags) && tool.tags.includes('dingtalk') && tool.tags.includes('read'), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk current-user tool tags are incomplete');
  return {
    toolName: tool.id,
    pluginId: tool.pluginId,
  };
}

export function assertDingTalkTargetEffectiveReadTool(value, expectedAgentId) {
  return assertDingTalkTargetEffectiveReadToolContract(value, expectedAgentId, {
    toolName: DINGTALK_TARGET_GATEWAY_READ_TOOL,
  });
}

export function assertDingTalkTargetReadInvocationContract(value, expectedProfile, contract) {
  invariant(isRecord(value), 'TARGET_GATEWAY_TOOL_INVOKE_INVALID', 'DingTalk tools.invoke result must be an object');
  invariant(value.ok === true, 'TARGET_GATEWAY_TOOL_INVOKE_FAILED', 'DingTalk current-user tool did not succeed');
  invariant(value.toolName === contract.toolName, 'TARGET_GATEWAY_TOOL_INVOKE_INVALID', 'DingTalk tools.invoke returned the wrong tool name');
  invariant(value.source === 'plugin', 'TARGET_GATEWAY_TOOL_INVOKE_INVALID', 'DingTalk tools.invoke returned the wrong source');
  invariant(isRecord(value.output), 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool output must be an object');
  const details = value.output.details;
  invariant(isRecord(details), 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool details must be an object');
  invariant(details.success === true, 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool details did not report success');
  invariant(details.toolName === contract.toolName, 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned the wrong tool name');
  invariant(details.dwsCanonicalPath === contract.canonicalPath, 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned the wrong DWS canonical path');
  invariant(details.profileRef === expectedProfile, 'TARGET_GATEWAY_PROFILE_MISMATCH', 'DingTalk tool details returned a different Profile');
  invariant(typeof details.schemaDigest === 'string' && /^[a-f0-9]{64}$/.test(details.schemaDigest), 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool details returned an invalid Schema digest');
  invariant(
    typeof details.observedAt === 'string'
      && !Number.isNaN(Date.parse(details.observedAt))
      && new Date(details.observedAt).toISOString() === details.observedAt,
    'TARGET_GATEWAY_TOOL_OUTPUT_INVALID',
    'DingTalk tool details returned an invalid observation time',
  );
  invariant(isRecord(details.data), 'TARGET_GATEWAY_DWS_RESULT_INVALID', 'DingTalk tool details are missing the DWS result envelope');
  invariant(details.data.ok === true && details.data.outcome === 'success' && Object.hasOwn(details.data, 'data'), 'TARGET_GATEWAY_DWS_RESULT_INVALID', 'DWS did not return a successful unified result envelope');
  invariant(Array.isArray(value.output.content) && value.output.content.length === 1, 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool output content must contain one item');
  invariant(value.output.content[0]?.type === 'text' && typeof value.output.content[0].text === 'string', 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool output content must be text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(value.output.content[0].text);
  } catch {
    throw new DingTalkTargetGatewayReadFailure('TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool text content is not valid JSON');
  }
  invariant(JSON.stringify(contentDetails) === JSON.stringify(details), 'TARGET_GATEWAY_TOOL_OUTPUT_INVALID', 'DingTalk tool text content differs from details');
  return {
    schemaDigest: details.schemaDigest,
    observedAt: details.observedAt,
  };
}

export function assertDingTalkTargetReadInvocation(value, expectedProfile) {
  return assertDingTalkTargetReadInvocationContract(value, expectedProfile, {
    toolName: DINGTALK_TARGET_GATEWAY_READ_TOOL,
    canonicalPath: DINGTALK_TARGET_GATEWAY_READ_CANONICAL_PATH,
  });
}

export async function runDingTalkTargetGatewayRead(options) {
  const input = parseDingTalkTargetGatewayReadInput(options.input);
  const token = validateDingTalkTargetGatewayToken(options.gatewayToken);
  const effective = await options.callGatewayFromCli(
    'tools.effective',
    { url: options.gatewayUrl, token, timeout: '30000', json: true },
    { sessionKey: input.sessionKey, agentId: input.agentId },
    { deviceIdentity: null, progress: false, scopes: ['operator.read'], sharedStateMode: 'read-only' },
  );
  const projected = assertDingTalkTargetEffectiveReadTool(effective, input.agentId);
  const invocation = await options.callGatewayFromCli(
    'tools.invoke',
    { url: options.gatewayUrl, token, timeout: '30000', json: true },
    {
      name: DINGTALK_TARGET_GATEWAY_READ_TOOL,
      args: { profile: input.profile, arguments: {} },
      sessionKey: input.sessionKey,
      agentId: input.agentId,
    },
    { deviceIdentity: null, progress: false, scopes: ['operator.write'], sharedStateMode: 'read-only' },
  );
  const verified = assertDingTalkTargetReadInvocation(invocation, input.profile);
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_CURRENT_USER_READ',
    status: 'PASSED',
    toolName: projected.toolName,
    pluginId: projected.pluginId,
    source: 'plugin',
    schemaDigest: verified.schemaDigest,
    observedAt: verified.observedAt,
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

export function serializeDingTalkTargetGatewayReadFailure(error) {
  return {
    formatVersion: 1,
    kind: 'JUNQI_DINGTALK_TARGET_GATEWAY_CURRENT_USER_READ',
    status: 'FAILED',
    code: error instanceof DingTalkTargetGatewayReadFailure
      ? error.code
      : 'TARGET_GATEWAY_READ_FAILED',
  };
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === SCRIPT_PATH) {
  try {
    const args = parseDingTalkTargetGatewayReadArguments(process.argv.slice(2));
    const input = await readDingTalkTargetGatewayReadInput(process.stdin);
    const gatewayToken = validateDingTalkTargetGatewayToken(process.env.OPENCLAW_GATEWAY_TOKEN);
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const runtime = await resolveOpenClawGatewayRuntime(args.packageJsonPath);
    const result = await runDingTalkTargetGatewayRead({
      callGatewayFromCli: runtime.callGatewayFromCli,
      gatewayUrl: args.gatewayUrl,
      gatewayToken,
      input,
    });
    console.log(JSON.stringify({
      ...result,
      openClawPackageVersion: runtime.packageVersion,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify(serializeDingTalkTargetGatewayReadFailure(error)));
    process.exitCode = 1;
  }
}
