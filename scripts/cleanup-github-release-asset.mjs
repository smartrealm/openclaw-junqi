import { fetchStatusWithDeadline } from './fetch-deadline.mjs';
import { githubApiHeaders, normalizeGitHubApiBase } from './github-api-base.mjs';
import {
  GitHubReadError,
  RetryBudget,
  rateLimitMetadata,
  timeoutWithinRetryBudget,
  withGitHubReadRetry,
} from './github-read-retry.mjs';
import {
  fetchReleaseAssetById,
  fetchReleaseById,
} from './verify-github-release-assets.mjs';

const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_TAG = /^v[0-9A-Za-z][0-9A-Za-z._-]*$/;
const SAFE_SOURCE_SHA = /^[0-9a-f]{40}$/;
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export class GitHubReleaseAssetCleanupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubReleaseAssetCleanupError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GitHubReleaseAssetCleanupError(code, message);
}

function sourceMarker(sourceSha) {
  return `<!-- junqi-release-source-sha: ${sourceSha} -->`;
}

function assertOwnedDraft(release, { tag, releaseId, sourceSha }) {
  if (!release || typeof release !== 'object' || String(release.id) !== String(releaseId)) {
    fail('RELEASE_ID_MISMATCH', 'GitHub returned a different release before starter cleanup');
  }
  if (release.draft !== true) fail('RELEASE_NOT_DRAFT', 'Release is no longer a draft; refusing starter cleanup');
  if (release.tag_name !== tag) fail('RELEASE_TAG_MISMATCH', 'Release tag changed before starter cleanup');
  if (typeof release.body !== 'string' || !release.body.includes(sourceMarker(sourceSha))) {
    fail('RELEASE_OWNERSHIP_MISMATCH', 'Release ownership marker changed before starter cleanup');
  }
}

export async function cleanupOwnedStarterAsset({
  apiBase,
  repo,
  tag,
  releaseId,
  sourceSha,
  asset,
  token,
  fetchImpl = fetch,
  timeoutMs,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  budget = undefined,
}) {
  if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required for starter cleanup');
  if (!SAFE_REPOSITORY.test(repo) || !SAFE_TAG.test(tag) || !SAFE_SOURCE_SHA.test(sourceSha)
    || !/^[1-9][0-9]*$/.test(String(releaseId ?? ''))
    || !Number.isSafeInteger(Number(releaseId))) {
    fail('INVALID_ARGUMENT', 'Starter cleanup repository, tag, release id, or source SHA is invalid');
  }
  if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0
    || typeof asset.name !== 'string' || !SAFE_ASSET_NAME.test(asset.name)) {
    fail('INVALID_ASSET', 'Starter cleanup requires an immutable asset id and name');
  }
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  if (budget !== undefined && !(budget instanceof RetryBudget)) {
    fail('INVALID_RETRY_BUDGET', 'budget must be a RetryBudget');
  }
  const retryOptions = {
    sleep,
    timeoutMs,
    ...(budget === undefined ? {} : { budget }),
  };
  const release = await fetchReleaseById({
    apiBase: normalizedApiBase,
    repo,
    releaseId,
    token,
    fetchImpl,
    retryOptions,
  });
  assertOwnedDraft(release, { tag, releaseId, sourceSha });

  let current;
  try {
    current = await fetchReleaseAssetById({
      apiBase: normalizedApiBase,
      repo,
      assetId: asset.id,
      token,
      fetchImpl,
      retryOptions,
    });
  } catch (error) {
    if (error instanceof GitHubReadError && error.status === 404) {
      return { status: 'ABSENT', assetId: asset.id, name: asset.name };
    }
    throw error;
  }
  if (current.name !== asset.name) {
    fail('ASSET_IDENTITY_MISMATCH', 'Starter asset name changed before cleanup');
  }
  if (current.state !== 'starter') {
    return { status: 'STATE_CHANGED', assetId: asset.id, name: asset.name, state: current.state };
  }
  if (current.size !== 0 || (current.digest != null && current.digest !== '')) {
    fail('STARTER_ASSET_NOT_EMPTY', 'Starter asset is no longer empty; refusing cleanup');
  }

  const url = `${normalizedApiBase}/repos/${repo}/releases/assets/${asset.id}`;
  await withGitHubReadRetry(async () => {
    const response = await fetchStatusWithDeadline(
      url,
      { method: 'DELETE', headers: githubApiHeaders(token) },
      {
        fetchImpl,
        timeoutMs: timeoutWithinRetryBudget(timeoutMs, budget),
        includeErrorBody: true,
      },
    );
    if (response.status !== 204 && response.status !== 404) {
      const metadata = rateLimitMetadata(response.headers, response.status, Date.now(), response.body);
      throw new GitHubReadError(
        url,
        response.status,
        `GitHub refused cleanup of starter asset ${asset.name}`,
        metadata.retryAfterMs,
        metadata,
      );
    }
  }, { sleep, ...(budget === undefined ? {} : { budget }) });
  return { status: 'DELETED', assetId: asset.id, name: asset.name };
}
