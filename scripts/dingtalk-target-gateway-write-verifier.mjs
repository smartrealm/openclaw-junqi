import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DINGTALK_TARGET_GATEWAY_READ_PLUGIN,
  DingTalkTargetGatewayReadFailure,
} from './verify-dingtalk-target-gateway-read.mjs';
import { stableDingTalkTargetGatewayFailureCode } from './verify-dingtalk-target-gateway-readonly.mjs';

export function targetGatewayWriteInvariant(condition, code, message) {
  if (!condition) throw new DingTalkTargetGatewayReadFailure(code, message);
}

export function isTargetGatewayRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resolveDingTalkWriteVerifierRuntime(packageJsonPath) {
  const resolvedPackageJson = await realpath(packageJsonPath).catch(() => null);
  targetGatewayWriteInvariant(resolvedPackageJson !== null, 'DINGTALK_PACKAGE_INVALID', 'DingTalk package.json is unavailable');
  targetGatewayWriteInvariant(path.basename(resolvedPackageJson) === 'package.json', 'DINGTALK_PACKAGE_INVALID', 'Resolved DingTalk package path is not package.json');
  const packageRoot = path.dirname(resolvedPackageJson);
  let packageDocument;
  try {
    packageDocument = JSON.parse(await readFile(resolvedPackageJson, 'utf8'));
  } catch {
    throw new DingTalkTargetGatewayReadFailure('DINGTALK_PACKAGE_INVALID', 'DingTalk package.json is invalid');
  }
  targetGatewayWriteInvariant(
    isTargetGatewayRecord(packageDocument) && packageDocument.name === '@junqi/openclaw-dingtalk-business',
    'DINGTALK_PACKAGE_INVALID',
    'Target package is not the JunQi DingTalk plugin',
  );
  const modulePaths = [];
  for (const moduleName of ['schema-contract.js', 'tool-specs.js']) {
    const unresolved = path.resolve(packageRoot, 'dist', moduleName);
    targetGatewayWriteInvariant(containedPath(packageRoot, unresolved), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module escapes the package');
    const resolved = await realpath(unresolved).catch(() => null);
    targetGatewayWriteInvariant(resolved !== null && containedPath(packageRoot, resolved), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module is unavailable');
    const moduleStats = await stat(resolved).catch(() => null);
    targetGatewayWriteInvariant(moduleStats?.isFile(), 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier module is not a regular file');
    modulePaths.push(resolved);
  }
  const [schemaModule, toolSpecsModule] = await Promise.all(
    modulePaths.map((modulePath) => import(pathToFileURL(modulePath).href)),
  );
  targetGatewayWriteInvariant(typeof schemaModule.buildSchemaValidatedArguments === 'function', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier argument validator is missing');
  targetGatewayWriteInvariant(typeof toolSpecsModule.TOOL_SCHEMA_TOOL_NAME === 'string', 'DINGTALK_VERIFIER_RUNTIME_INVALID', 'DingTalk verifier Schema tool identity is missing');
  return {
    packageVersion: typeof packageDocument.version === 'string' ? packageDocument.version : null,
    buildSchemaValidatedArguments: schemaModule.buildSchemaValidatedArguments,
    schemaToolName: toolSpecsModule.TOOL_SCHEMA_TOOL_NAME,
  };
}

function findEffectiveTool(value, expectedAgentId, contract) {
  targetGatewayWriteInvariant(isTargetGatewayRecord(value), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory must be an object');
  targetGatewayWriteInvariant(value.agentId === expectedAgentId, 'TARGET_GATEWAY_AGENT_MISMATCH', 'Effective tool inventory resolved a different Agent');
  targetGatewayWriteInvariant(Array.isArray(value.groups), 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'Effective tool inventory groups are missing');
  const matches = value.groups
    .filter((group) => isTargetGatewayRecord(group) && group.source === 'plugin' && Array.isArray(group.tools))
    .flatMap((group) => group.tools)
    .filter((tool) => isTargetGatewayRecord(tool) && tool.id === contract.toolName);
  targetGatewayWriteInvariant(matches.length === 1, 'TARGET_GATEWAY_DINGTALK_TOOL_MISSING', 'Effective inventory must contain exactly one expected DingTalk tool');
  return matches[0];
}

export function assertDingTalkTargetEffectiveSideEffectTool(value, expectedAgentId, contract) {
  const tool = findEffectiveTool(value, expectedAgentId, contract);
  targetGatewayWriteInvariant(tool.source === 'plugin' && tool.pluginId === DINGTALK_TARGET_GATEWAY_READ_PLUGIN, 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk side-effect tool has the wrong plugin owner');
  targetGatewayWriteInvariant(tool.deniedBySession !== true, 'TARGET_GATEWAY_DINGTALK_TOOL_DENIED', 'DingTalk side-effect tool is denied by the target Session');
  targetGatewayWriteInvariant(tool.risk === contract.risk, 'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID', 'DingTalk side-effect tool risk differs from the reviewed contract');
  targetGatewayWriteInvariant(
    Array.isArray(tool.tags) && tool.tags.includes('dingtalk') && tool.tags.includes(contract.effect),
    'TARGET_GATEWAY_EFFECTIVE_TOOLS_INVALID',
    'DingTalk side-effect tool tags differ from the reviewed contract',
  );
}

export function assertDingTalkTargetSchemaInvocation(value, schemaToolName, contract, errorCode) {
  targetGatewayWriteInvariant(isTargetGatewayRecord(value), errorCode, 'DingTalk Schema invocation result must be an object');
  targetGatewayWriteInvariant(value.ok === true && value.toolName === schemaToolName && value.source === 'plugin', errorCode, 'DingTalk Schema invocation identity is invalid');
  targetGatewayWriteInvariant(isTargetGatewayRecord(value.output) && isTargetGatewayRecord(value.output.details), errorCode, 'DingTalk Schema invocation details are missing');
  const details = value.output.details;
  targetGatewayWriteInvariant(
    details.success === true
      && details.toolName === contract.toolName
      && details.dwsCanonicalPath === contract.canonicalPath,
    errorCode,
    'DingTalk Schema invocation returned the wrong contract',
  );
  targetGatewayWriteInvariant(typeof details.schemaDigest === 'string' && /^[a-f0-9]{64}$/.test(details.schemaDigest), errorCode, 'DingTalk Schema digest is invalid');
  targetGatewayWriteInvariant(
    details.effect === contract.effect
      && details.risk === contract.risk
      && details.confirmation === contract.confirmation
      && details.idempotency === contract.idempotency,
    errorCode,
    'DingTalk Schema safety contract differs from the reviewed contract',
  );
  targetGatewayWriteInvariant(isTargetGatewayRecord(details.parameters) && isTargetGatewayRecord(details.constraints), errorCode, 'DingTalk Schema parameters or constraints are invalid');
  targetGatewayWriteInvariant(Array.isArray(value.output.content) && value.output.content.length === 1, errorCode, 'DingTalk Schema content is invalid');
  targetGatewayWriteInvariant(value.output.content[0]?.type === 'text' && typeof value.output.content[0].text === 'string', errorCode, 'DingTalk Schema content is not text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(value.output.content[0].text);
  } catch {
    throw new DingTalkTargetGatewayReadFailure(errorCode, 'DingTalk Schema content is not JSON');
  }
  targetGatewayWriteInvariant(JSON.stringify(contentDetails) === JSON.stringify(details), errorCode, 'DingTalk Schema content differs from details');
  return {
    digest: details.schemaDigest,
    schema: { parameters: details.parameters, constraints: details.constraints },
  };
}

export function assertDingTalkTargetApprovalPreflight(value, contract, errorCode) {
  targetGatewayWriteInvariant(isTargetGatewayRecord(value), errorCode, 'DingTalk approval preflight result must be an object');
  targetGatewayWriteInvariant(
    value.ok === false
      && value.toolName === contract.toolName
      && value.requiresApproval === true
      && isTargetGatewayRecord(value.error)
      && value.error.code === 'requires_approval',
    errorCode,
    'DingTalk write did not stop at the approval boundary',
  );
}

export function isDingTalkTargetApprovalStop(value, contract) {
  return isTargetGatewayRecord(value)
    && value.ok === false
    && value.toolName === contract.toolName
    && value.requiresApproval === true
    && isTargetGatewayRecord(value.error)
    && value.error.code === 'requires_approval';
}

export function assertDingTalkTargetVerifiedWrite(
  value,
  expectedProfile,
  contract,
  expectedDigest,
  resourceIdField,
  errorCode,
) {
  targetGatewayWriteInvariant(isTargetGatewayRecord(value), errorCode, 'DingTalk tools.invoke result must be an object');
  targetGatewayWriteInvariant(value.ok === true && value.toolName === contract.toolName && value.source === 'plugin', errorCode, 'DingTalk tools.invoke did not return the expected plugin result');
  targetGatewayWriteInvariant(isTargetGatewayRecord(value.output) && isTargetGatewayRecord(value.output.details), errorCode, 'DingTalk tool details are missing');
  const details = value.output.details;
  targetGatewayWriteInvariant(
    details.success === true
      && details.toolName === contract.toolName
      && details.dwsCanonicalPath === contract.canonicalPath
      && details.profileRef === expectedProfile
      && details.schemaDigest === expectedDigest,
    errorCode,
    'DingTalk tool identity or Schema digest changed during execution',
  );
  targetGatewayWriteInvariant(
    typeof details.observedAt === 'string'
      && !Number.isNaN(Date.parse(details.observedAt))
      && new Date(details.observedAt).toISOString() === details.observedAt,
    errorCode,
    'DingTalk tool observation time is invalid',
  );
  targetGatewayWriteInvariant(
    isTargetGatewayRecord(details.data)
      && details.data.ok === true
      && details.data.outcome === 'success'
      && Object.hasOwn(details.data, 'data'),
    errorCode,
    'DingTalk DWS result envelope is invalid',
  );
  targetGatewayWriteInvariant(isTargetGatewayRecord(details.verification), errorCode, 'DingTalk verification evidence is missing');
  const verification = details.verification;
  targetGatewayWriteInvariant(
    verification.status === 'verified'
      && typeof verification.resourceId === 'string'
      && verification.resourceId.trim().length > 0
      && verification.verifierToolName === contract.toolName
      && verification.verifierCanonicalPath === contract.canonicalPath
      && verification.verifierSchemaDigest === expectedDigest,
    errorCode,
    'DingTalk write was not authoritatively verified',
  );
  targetGatewayWriteInvariant(
    typeof verification.observedAt === 'string'
      && !Number.isNaN(Date.parse(verification.observedAt))
      && new Date(verification.observedAt).toISOString() === verification.observedAt,
    errorCode,
    'DingTalk verification time is invalid',
  );
  targetGatewayWriteInvariant(
    isTargetGatewayRecord(details.data.data)
      && details.data.data.verified === true
      && details.data.data[resourceIdField] === verification.resourceId,
    errorCode,
    'DingTalk DWS result and verification resource differ',
  );
  targetGatewayWriteInvariant(Array.isArray(value.output.content) && value.output.content.length === 1, errorCode, 'DingTalk tool text content is invalid');
  targetGatewayWriteInvariant(value.output.content[0]?.type === 'text' && typeof value.output.content[0].text === 'string', errorCode, 'DingTalk tool content is not text');
  let contentDetails;
  try {
    contentDetails = JSON.parse(value.output.content[0].text);
  } catch {
    throw new DingTalkTargetGatewayReadFailure(errorCode, 'DingTalk tool content is not JSON');
  }
  targetGatewayWriteInvariant(JSON.stringify(contentDetails) === JSON.stringify(details), errorCode, 'DingTalk tool content differs from details');
  return { resourceId: verification.resourceId };
}

export function dingTalkTargetWriteFailure(contract, stage, error) {
  return {
    toolName: contract.toolName,
    canonicalPath: contract.canonicalPath,
    stage,
    code: stableDingTalkTargetGatewayFailureCode(error),
  };
}
