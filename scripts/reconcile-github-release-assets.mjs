#!/usr/bin/env node

import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectLocalReleaseAssets,
  fetchAllRemoteAssets,
  fetchReleaseById,
} from './verify-github-release-assets.mjs';
import { cleanupOwnedStarterAsset } from './cleanup-github-release-asset.mjs';
import { normalizeGitHubApiBase } from './github-api-base.mjs';
import { DEFAULT_RETRY_BUDGET_MS, RetryBudget } from './github-read-retry.mjs';
import {
  assertReleasePublicationSealMatchesAssets,
  readReleasePublicationSeal,
} from './release-publication-seal.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_RECONCILE_ATTEMPTS = 12;
const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_PUBLICATION_FILES = 130;

export class GitHubReleaseReconciliationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubReleaseReconciliationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GitHubReleaseReconciliationError(code, message);
}

function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function sourceMarker(sourceSha) {
  return `<!-- junqi-release-source-sha: ${sourceSha} -->`;
}

export function planReleaseAssetUploads({ localAssets, remoteAssets, release, tag, sourceSha }) {
  if (!release || typeof release !== 'object' || !Number.isSafeInteger(release.id) || release.id <= 0) {
    fail('INVALID_RELEASE', 'Remote release has no valid immutable id');
  }
  if (release.draft !== true) fail('RELEASE_NOT_DRAFT', 'Only an owned draft release can be reconciled');
  if (release.tag_name !== tag) fail('RELEASE_TAG_MISMATCH', 'Remote release tag differs from the expected tag');
  if (typeof release.body !== 'string' || !release.body.includes(sourceMarker(sourceSha))) {
    fail('RELEASE_OWNERSHIP_MISMATCH', 'Remote draft does not carry this source transaction marker');
  }
  if (!Array.isArray(localAssets) || !Array.isArray(remoteAssets)) fail('INVALID_ASSET_SET', 'Asset sets must be arrays');
  if (localAssets.length === 0 || localAssets.length > MAX_PUBLICATION_FILES) fail('INVALID_ASSET_COUNT', 'Local release asset count is invalid');
  if (remoteAssets.length > MAX_PUBLICATION_FILES) fail('INVALID_ASSET_COUNT', 'Remote release asset count is unbounded');

  const expectedByName = new Map(localAssets.map((asset) => [asset.name, asset]));
  if (expectedByName.size !== localAssets.length) fail('DUPLICATE_LOCAL_ASSET', 'Local release asset names are not unique');
  const seen = new Set();
  const cleanup = [];
  for (const remote of remoteAssets) {
    if (!remote || typeof remote.name !== 'string' || seen.has(remote.name)) {
      fail('DUPLICATE_REMOTE_ASSET', 'Remote release asset names are invalid or duplicated');
    }
    seen.add(remote.name);
    const expected = expectedByName.get(remote.name);
    if (!expected) fail('UNEXPECTED_REMOTE_ASSET', `Remote release contains unexpected asset ${remote.name}`);
    if (!Number.isSafeInteger(remote.id) || remote.id <= 0) {
      fail('REMOTE_ASSET_ID_UNAVAILABLE', `Remote release asset has no immutable id: ${remote.name}`);
    }
    // A failed upload can leave an empty `starter` asset. Only this exact
    // state is eligible for cleanup; uploaded or ambiguous assets fail closed.
    if (remote.state === 'starter') {
      if (remote.size !== 0 || (remote.digest != null && remote.digest !== '')) {
        fail('REMOTE_ASSET_CONFLICT', `Starter asset is not empty for ${remote.name}`);
      }
      cleanup.push({ id: remote.id, name: remote.name });
      continue;
    }
    if (remote.state !== 'uploaded') {
      fail('REMOTE_ASSET_STATE_UNAVAILABLE', `Remote release asset state is not uploaded for ${remote.name}`);
    }
    if (remote.size !== expected.bytes) {
      fail('REMOTE_ASSET_CONFLICT', `Remote release asset size differs for ${remote.name}`);
    }
    if (typeof remote.digest !== 'string' || !remote.digest.startsWith('sha256:')) {
      fail('REMOTE_ASSET_DIGEST_UNAVAILABLE', `Remote release asset digest is unavailable for ${remote.name}`);
    }
    if (!equalDigest(remote.digest.slice('sha256:'.length), expected.sha256)) {
      fail('REMOTE_ASSET_CONFLICT', `Remote release asset digest differs for ${remote.name}`);
    }
  }

  if (cleanup.length > 0) {
    return {
      status: 'CLEANUP_REQUIRED',
      releaseId: release.id,
      cleanup: cleanup.sort((left, right) => left.name.localeCompare(right.name)),
    };
  }
  return {
    status: 'READY',
    releaseId: release.id,
    missing: localAssets
      .filter((asset) => !seen.has(asset.name))
      .map((asset) => asset.name)
      .sort((left, right) => left.localeCompare(right)),
  };
}

export function parseReconciliationArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) fail('INVALID_ARGUMENT', `Invalid argument near ${flag ?? '<end>'}`);
    const key = flag.slice(2);
    if (!['root', 'repo', 'tag', 'release-id', 'source-sha', 'seal', 'seal-sha'].includes(key) || Object.hasOwn(values, key)) {
      fail('INVALID_ARGUMENT', `Unexpected argument ${flag}`);
    }
    values[key] = value;
  }
  for (const key of ['root', 'repo', 'tag', 'release-id', 'source-sha', 'seal', 'seal-sha']) {
    if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo)) fail('INVALID_ARGUMENT', '--repo is invalid');
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(values.tag)) fail('INVALID_ARGUMENT', '--tag is invalid');
  if (!/^[1-9][0-9]*$/.test(values['release-id'])) fail('INVALID_ARGUMENT', '--release-id is invalid');
  if (!/^[0-9a-f]{40}$/.test(values['source-sha'])) fail('INVALID_ARGUMENT', '--source-sha is invalid');
  if (!/^[0-9a-f]{64}$/.test(values['seal-sha'])) fail('INVALID_ARGUMENT', '--seal-sha is invalid');
  return values;
}

/**
 * Low-level release adapter. The production entry point is the CLI, which
 * must load and digest-bind a publication seal before calling this function.
 */
export async function reconcileGitHubReleaseAssets({
  apiBase,
  repo,
  tag,
  releaseId,
  sourceSha,
  root,
  publicationSeal = undefined,
  token,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  fetchImpl = fetch,
  operationTimeoutMs = DEFAULT_RETRY_BUDGET_MS,
  budget = undefined,
}) {
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs <= 0) {
    fail('INVALID_OPERATION_TIMEOUT', 'operationTimeoutMs must be a positive safe integer');
  }
  if (budget !== undefined && !(budget instanceof RetryBudget)) {
    fail('INVALID_RETRY_BUDGET', 'budget must be a RetryBudget');
  }
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const retryBudget = budget ?? new RetryBudget({ timeoutMs: operationTimeoutMs, sleep });
  const localAssets = await collectLocalReleaseAssets(root, {
    requireManifest: true,
    publicationSeal,
  });
  if (publicationSeal) {
    assertReleasePublicationSealMatchesAssets(publicationSeal, localAssets, {
      sourceSha,
      releaseRef: `refs/tags/${tag}`,
    });
  }
  let lastError;
  for (let attempt = 1; attempt <= MAX_RECONCILE_ATTEMPTS; attempt += 1) {
    const retryOptions = { sleep, timeoutMs: 30_000, budget: retryBudget };
    const release = await fetchReleaseById({
      apiBase: normalizedApiBase, repo, releaseId, token, fetchImpl, retryOptions,
    });
    const remoteAssets = await fetchAllRemoteAssets({
      apiBase: normalizedApiBase, repo, releaseId, token, fetchImpl, retryOptions,
    });
    try {
      const plan = planReleaseAssetUploads({ localAssets, remoteAssets, release, tag, sourceSha });
      if (plan.status === 'CLEANUP_REQUIRED') {
        for (const asset of plan.cleanup) {
          await cleanupOwnedStarterAsset({
            apiBase: normalizedApiBase,
            repo,
            tag,
            releaseId,
            sourceSha,
            asset,
            token,
            fetchImpl,
            sleep,
            budget: retryBudget,
          });
        }
        if (attempt === MAX_RECONCILE_ATTEMPTS) {
          fail('RECONCILIATION_LIMIT_EXCEEDED', 'Starter asset cleanup did not converge within the bounded retry window');
        }
        await retryBudget.wait(RECONCILE_RETRY_DELAY_MS);
        continue;
      }
      return plan;
    } catch (error) {
      lastError = error;
      if (!(error instanceof GitHubReleaseReconciliationError)
        || error.code !== 'REMOTE_ASSET_DIGEST_UNAVAILABLE'
        || attempt === MAX_RECONCILE_ATTEMPTS) throw error;
      await retryBudget.wait(RECONCILE_RETRY_DELAY_MS);
    }
  }
  if (lastError) throw lastError;
  fail('RECONCILIATION_LIMIT_EXCEEDED', 'Release asset reconciliation did not converge');
}

async function main() {
  try {
    const args = parseReconciliationArgs(process.argv.slice(2));
    const token = process.env.GH_TOKEN;
    if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required');
    const publicationSeal = await readReleasePublicationSeal(args.seal, {
      sourceSha: args['source-sha'],
      releaseRef: `refs/tags/${args.tag}`,
      sealSha256: args['seal-sha'],
    });
    const result = await reconcileGitHubReleaseAssets({
      apiBase: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
      repo: args.repo,
      tag: args.tag,
      releaseId: args['release-id'],
      sourceSha: args['source-sha'],
      root: args.root,
      publicationSeal,
      token,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error?.code ?? 'RELEASE_RECONCILIATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
