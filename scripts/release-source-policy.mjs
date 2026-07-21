import { appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const VERSION_TAG = /^v[^/]+$/;

export const RELEASE_SOURCE_KINDS = Object.freeze({
  CANDIDATE_MAIN_PUSH: 'CANDIDATE_MAIN_PUSH',
  CANDIDATE_MAIN_DISPATCH: 'CANDIDATE_MAIN_DISPATCH',
});

export class ReleaseSourcePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseSourcePolicyError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseSourcePolicyError(code, message);
}

function requireCommitSha(name, value) {
  if (!FULL_COMMIT_SHA.test(value ?? '')) {
    fail('INVALID_COMMIT_SHA', `${name} must be a full lowercase commit SHA`);
  }
}

function requireEventIdentity({ eventSha, sourceSha }) {
  requireCommitSha('GITHUB_SHA', eventSha);
  requireCommitSha('source_sha', sourceSha);
  if (eventSha !== sourceSha) {
    fail('SOURCE_IDENTITY_MISMATCH', 'source_sha must equal the immutable workflow event SHA');
  }
}

function isMainPush(context) {
  return context.eventName === 'push'
    && context.eventRef === 'refs/heads/main'
    && context.eventRefName === 'main';
}

function isMainDispatch(context) {
  return context.eventName === 'workflow_dispatch'
    && context.dispatchRef === 'main'
    && context.eventRef === 'refs/heads/main'
    && context.eventRefName === 'main';
}

function isVersionTagPush(context) {
  return context.eventName === 'push'
    && context.eventRef.startsWith('refs/tags/')
    && VERSION_TAG.test(context.eventRefName)
    && context.eventRef === `refs/tags/${context.eventRefName}`;
}

/**
 * The policy is deliberately pure. Runtime adapters only provide immutable
 * event context; privileged promotion is intentionally outside this workflow.
 */
export function evaluateReleaseSource(context) {
  const normalized = {
    eventName: context?.eventName ?? '',
    eventRef: context?.eventRef ?? '',
    eventRefName: context?.eventRefName ?? '',
    eventSha: context?.eventSha ?? '',
    sourceSha: context?.sourceSha ?? '',
    dispatchRef: context?.dispatchRef ?? '',
  };

  if (isMainPush(normalized)) {
    requireEventIdentity(normalized);
    return Object.freeze({
      sourceSha: normalized.sourceSha,
      releaseRef: 'refs/heads/main',
      releaseTag: '',
      sourceKind: RELEASE_SOURCE_KINDS.CANDIDATE_MAIN_PUSH,
      signingEnabled: false,
    });
  }

  if (isMainDispatch(normalized)) {
    requireEventIdentity(normalized);
    return Object.freeze({
      sourceSha: normalized.sourceSha,
      releaseRef: 'refs/heads/main',
      releaseTag: '',
      sourceKind: RELEASE_SOURCE_KINDS.CANDIDATE_MAIN_DISPATCH,
      signingEnabled: false,
    });
  }

  if (isVersionTagPush(normalized)) {
    requireEventIdentity(normalized);
    fail(
      'TRUSTED_PROMOTION_REQUIRED',
      `Version tag ${normalized.eventRefName} cannot access signing or publication from tag-owned workflow code`,
    );
  }

  fail(
    'UNSUPPORTED_RELEASE_EVENT',
    'Only push to main or dispatch from main is a valid candidate source; version tags require trusted promotion',
  );
}

function gitOutput(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function resolveReleaseSourceFromEnvironment(env = process.env) {
  const sourceSha = gitOutput(['rev-parse', 'HEAD^{commit}']);
  const context = {
    eventName: env.GITHUB_EVENT_NAME,
    eventRef: env.GITHUB_REF,
    eventRefName: env.GITHUB_REF_NAME,
    eventSha: env.GITHUB_SHA,
    sourceSha,
    dispatchRef: env.DISPATCH_REF,
  };
  return evaluateReleaseSource(context);
}

export async function writeReleaseSourceOutputs(decision, outputPath) {
  if (!outputPath) fail('OUTPUT_PATH_MISSING', 'GITHUB_OUTPUT is required');
  await appendFile(outputPath, [
    `sha=${decision.sourceSha}`,
    `release-ref=${decision.releaseRef}`,
    `release-tag=${decision.releaseTag}`,
    `source-kind=${decision.sourceKind}`,
    `signing-enabled=${decision.signingEnabled ? 'true' : 'false'}`,
    'source-identity=verified',
    '',
  ].join('\n'));
}

export async function main() {
  try {
    const decision = resolveReleaseSourceFromEnvironment();
    await writeReleaseSourceOutputs(decision, process.env.GITHUB_OUTPUT);
    console.log(`Release source accepted: ${decision.sourceKind} ${decision.sourceSha}`);
  } catch (error) {
    const code = error instanceof ReleaseSourcePolicyError ? error.code : 'SOURCE_POLICY_FAILED';
    console.error(`::error::${code}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
