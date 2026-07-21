#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import {
  FetchDeadlineError,
  FetchResponseError,
  fetchJsonWithDeadline,
} from './fetch-deadline.mjs';
import { cleanupOwnedStarterAsset } from './cleanup-github-release-asset.mjs';
import { githubApiHeaders, normalizeGitHubApiBase } from './github-api-base.mjs';
import {
  calculateGitHubRetryDelay,
  DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
  DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
  assertProviderDelayWithinBound,
  GitHubReadError,
  RetryBudget,
  rateLimitMetadata,
  timeoutWithinRetryBudget,
  shouldRetryGitHubRead,
} from './github-read-retry.mjs';
import {
  collectLocalReleaseAssets,
  fetchAllRemoteAssets,
  fetchReleaseById,
} from './verify-github-release-assets.mjs';
import {
  GitHubReleaseReconciliationError,
  planReleaseAssetUploads,
} from './reconcile-github-release-assets.mjs';
import { fileIdentity, sameFileIdentity } from './stable-file.mjs';
import {
  assertReleasePublicationSealMatchesAssets,
  readReleasePublicationSeal,
} from './release-publication-seal.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_UPLOAD_BYTES_PER_SECOND = 1024 * 1024;
const MAX_UPLOAD_TIMEOUT_MS = 45 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_UPLOAD_ATTEMPTS = 3;
const MAX_READ_ATTEMPTS = 4;
const MAX_MUTATION_VISIBILITY_ATTEMPTS = 6;
const DEFAULT_UPLOAD_BUDGET_MS = 120 * 60_000;
const RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000]);
const RECONCILABLE_UPLOAD_RESPONSE_CODES = Object.freeze(new Set([
  'UPLOAD_RESPONSE_INVALID',
  'UPLOAD_RESPONSE_MISMATCH',
  'UPLOAD_RESPONSE_STATE',
  'UPLOAD_RESPONSE_DIGEST_UNAVAILABLE',
  'UPLOAD_RESPONSE_DIGEST_MISMATCH',
]));
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_TAG = /^v[0-9A-Za-z][0-9A-Za-z._-]*$/;
const SAFE_SOURCE_SHA = /^[0-9a-f]{40}$/;
const SAFE_RELEASE_ID = /^[1-9][0-9]*$/;
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const RETRYABLE_HTTP_STATUSES = Object.freeze(new Set([408, 425, 429, 500, 502, 503, 504]));

export class GitHubReleaseUploadError extends Error {
  constructor(
    code,
    message,
    {
      retryable = false,
      status = undefined,
      retryAfterMs = undefined,
      rateLimited = false,
      rateLimitRemaining = undefined,
      rateLimitResetAfterMs = undefined,
      cause = undefined,
    } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GitHubReleaseUploadError';
    this.code = code;
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
    if (Number.isSafeInteger(retryAfterMs)) this.retryAfterMs = retryAfterMs;
    if (rateLimited === true) this.rateLimited = true;
    if (Number.isSafeInteger(rateLimitRemaining)) this.rateLimitRemaining = rateLimitRemaining;
    if (Number.isSafeInteger(rateLimitResetAfterMs)) this.rateLimitResetAfterMs = rateLimitResetAfterMs;
  }
}

function fail(code, message, options = undefined) {
  throw new GitHubReleaseUploadError(code, message, options);
}

function positiveReleaseId(value) {
  const text = String(value ?? '');
  if (!SAFE_RELEASE_ID.test(text)) return undefined;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}

function sourceMarker(sourceSha) {
  return `<!-- junqi-release-source-sha: ${sourceSha} -->`;
}

function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function calculateUploadDeadlineMs(
  bytes,
  {
    baseTimeoutMs = DEFAULT_TIMEOUT_MS,
    minimumBytesPerSecond = MIN_UPLOAD_BYTES_PER_SECOND,
    maximumTimeoutMs = MAX_UPLOAD_TIMEOUT_MS,
  } = {},
) {
  for (const [value, name, allowZero] of [
    [bytes, 'bytes', true],
    [baseTimeoutMs, 'baseTimeoutMs', false],
    [minimumBytesPerSecond, 'minimumBytesPerSecond', false],
    [maximumTimeoutMs, 'maximumTimeoutMs', false],
  ]) {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
      throw new TypeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
    }
  }
  if (maximumTimeoutMs < baseTimeoutMs) {
    throw new TypeError('maximumTimeoutMs must be greater than or equal to baseTimeoutMs');
  }
  const transferBudgetMs = Math.ceil((bytes * 1_000) / minimumBytesPerSecond);
  if (!Number.isSafeInteger(transferBudgetMs)) {
    throw new TypeError('bytes exceed the safely representable upload deadline range');
  }
  return Math.min(maximumTimeoutMs, baseTimeoutMs + transferBudgetMs);
}

export function parseUploadArgs(argv) {
  const values = { assets: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) {
      fail('INVALID_ARGUMENT', `Invalid argument near ${flag ?? '<end>'}`);
    }
    const key = flag.slice(2);
    if (!['root', 'repo', 'tag', 'release-id', 'source-sha', 'asset', 'seal', 'seal-sha'].includes(key)) {
      fail('INVALID_ARGUMENT', `Unexpected argument ${flag}`);
    }
    if (key === 'asset') {
      if (!SAFE_ASSET_NAME.test(value)) fail('INVALID_ARGUMENT', `Invalid release asset name: ${value}`);
      if (values.assets.includes(value)) fail('INVALID_ARGUMENT', `Release asset was repeated: ${value}`);
      values.assets.push(value);
    } else {
      if (Object.hasOwn(values, key)) fail('INVALID_ARGUMENT', `Argument repeated: ${flag}`);
      values[key] = value;
    }
  }
  for (const key of ['root', 'repo', 'tag', 'release-id', 'source-sha', 'seal', 'seal-sha']) {
    if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  }
  if (!SAFE_REPOSITORY.test(values.repo)) fail('INVALID_ARGUMENT', '--repo is invalid');
  if (!SAFE_TAG.test(values.tag)) fail('INVALID_ARGUMENT', '--tag is invalid');
  if (!SAFE_RELEASE_ID.test(values['release-id']) || !positiveReleaseId(values['release-id'])) {
    fail('INVALID_ARGUMENT', '--release-id is invalid or exceeds the safe integer range');
  }
  if (!SAFE_SOURCE_SHA.test(values['source-sha'])) fail('INVALID_ARGUMENT', '--source-sha is invalid');
  if (!/^[0-9a-f]{64}$/.test(values['seal-sha'])) fail('INVALID_ARGUMENT', '--seal-sha is invalid');
  return values;
}

function retryableError(error) {
  if (error?.retryable === true) return true;
  if (error instanceof FetchDeadlineError) return true;
  if (error instanceof GitHubReadError) return shouldRetryGitHubRead(error);
  if (error instanceof FetchResponseError) {
    return ['INVALID_RESPONSE', 'INVALID_JSON', 'CONTENT_LENGTH_MISMATCH'].includes(error.code);
  }
  if (error?.code === 'FETCH_TIMEOUT' || error?.code === 'FETCH_TRANSPORT_ERROR') return true;
  return error instanceof TypeError && /fetch|network|socket|connect/i.test(error.message ?? '');
}

function mutationOutcomeMayBeAmbiguous(error) {
  if (error instanceof GitHubReleaseUploadError) {
    // 422 commonly means the remote accepted the bytes but the duplicate
    // response raced visibility. Probe once through the reconciler; other
    // deterministic 4xx responses must fail without an expensive loop.
    return error.rateLimited === true
      || error.status === 422
      || error.retryable === true
      || RECONCILABLE_UPLOAD_RESPONSE_CODES.has(error.code);
  }
  if (error instanceof GitHubReadError) return retryableError(error);
  return error instanceof FetchDeadlineError
    || error instanceof FetchResponseError
    || error?.code === 'FETCH_TRANSPORT_ERROR';
}

function apiPrefix(apiBase) {
  let parsed;
  try {
    parsed = new URL(apiBase);
  } catch {
    fail('INVALID_API_BASE', 'GITHUB_API_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail('INVALID_API_BASE', 'GITHUB_API_URL must be an HTTPS origin without credentials or query parameters');
  }
  return parsed;
}

function uploadPathPrefix(api) {
  const prefix = api.pathname.replace(/\/+$/, '');
  if (api.hostname !== 'api.github.com' && prefix.endsWith('/api/v3')) {
    return `${prefix.slice(0, -'/v3'.length)}/uploads`;
  }
  return prefix;
}

function uploadBaseUrl({ release, apiBase, repo, releaseId }) {
  const id = positiveReleaseId(releaseId);
  if (!id) fail('INVALID_RELEASE_ID', 'Release id is not a safe positive integer');
  const api = apiPrefix(apiBase);
  let raw = typeof release?.upload_url === 'string' && release.upload_url.length > 0
    ? release.upload_url
    : undefined;
  if (raw) raw = raw.replace(/\{\?[^}]*\}$/, '');
  if (!raw) {
    const host = api.hostname === 'api.github.com' ? 'uploads.github.com' : api.hostname;
    const origin = `${api.protocol}//${host}${api.port ? `:${api.port}` : ''}`;
    const prefix = uploadPathPrefix(api);
    raw = `${origin}${prefix}/repos/${repo}/releases/${id}/assets`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('INVALID_UPLOAD_URL', 'GitHub release upload_url is not a valid URL');
  }
  const allowedHosts = new Set([api.hostname]);
  if (api.hostname === 'api.github.com') allowedHosts.add('uploads.github.com');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || !allowedHosts.has(parsed.hostname)
    || (parsed.hostname === api.hostname && parsed.port !== api.port)
    || (parsed.hostname === 'uploads.github.com' && parsed.port !== '')) {
    fail('INVALID_UPLOAD_URL', 'GitHub release upload_url is outside the trusted API host boundary');
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    fail('INVALID_UPLOAD_URL', 'GitHub release upload_url contains invalid path encoding');
  }
  const suffix = `/repos/${repo}/releases/${id}/assets`;
  const expectedPrefix = api.pathname.replace(/\/+$/, '');
  const acceptedPaths = new Set([suffix, `${expectedPrefix}${suffix}`, `${uploadPathPrefix(api)}${suffix}`]);
  if (!acceptedPaths.has(decodedPath)) {
    fail('UPLOAD_RELEASE_ID_MISMATCH', 'GitHub release upload_url is not bound to the requested release id');
  }
  return parsed;
}

export function buildReleaseAssetUploadUrl({ release, apiBase, repo, releaseId, name }) {
  if (!SAFE_ASSET_NAME.test(name)) fail('INVALID_ASSET_NAME', `Invalid release asset name: ${name}`);
  const url = uploadBaseUrl({ release, apiBase, repo, releaseId });
  url.searchParams.set('name', name);
  return url.toString();
}

function assertOwnedDraft(release, { repo, tag, releaseId, sourceSha }) {
  const expectedId = positiveReleaseId(releaseId);
  if (!release || typeof release !== 'object' || !Number.isSafeInteger(release.id) || release.id !== expectedId) {
    fail('RELEASE_ID_MISMATCH', 'GitHub returned a different release identity');
  }
  if (release.draft !== true) fail('RELEASE_NOT_DRAFT', 'Release is no longer a draft; refusing asset mutation');
  if (release.tag_name !== tag) fail('RELEASE_TAG_MISMATCH', 'GitHub release tag differs from the expected tag');
  if (typeof release.body !== 'string' || !release.body.includes(sourceMarker(sourceSha))) {
    fail('RELEASE_OWNERSHIP_MISMATCH', 'Release does not carry this source transaction marker');
  }
  if (!SAFE_REPOSITORY.test(repo)) fail('INVALID_ARGUMENT', 'Repository identity is invalid');
}

function findLocalAsset(localAssets, name) {
  const asset = localAssets.find((entry) => entry.name === name);
  if (!asset) fail('UNKNOWN_ASSET', `Release asset is not present in the immutable local set: ${name}`);
  return asset;
}

export function validateUploadResponse({ status, body, headers, expected }) {
  if (status !== 201) {
    const metadata = rateLimitMetadata(headers, status, Date.now(), body);
    const retryable = RETRYABLE_HTTP_STATUSES.has(status) || metadata.rateLimited;
    fail(
      retryable ? 'UPLOAD_RETRYABLE_STATUS' : 'UPLOAD_REJECTED',
      `GitHub release asset upload returned HTTP ${status}`,
      {
        retryable,
        status,
        retryAfterMs: metadata.retryAfterMs,
        rateLimited: metadata.rateLimited,
        rateLimitRemaining: metadata.rateLimitRemaining,
        rateLimitResetAfterMs: metadata.rateLimitResetAfterMs,
      },
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('UPLOAD_RESPONSE_INVALID', 'GitHub release asset upload returned an invalid JSON object');
  }
  if (!Number.isSafeInteger(body.id) || body.id <= 0 || body.name !== expected.name || body.size !== expected.bytes) {
    fail('UPLOAD_RESPONSE_MISMATCH', `GitHub returned an unexpected asset identity for ${expected.name}`);
  }
  if (body.state !== 'uploaded') {
    fail('UPLOAD_RESPONSE_STATE', `GitHub did not report ${expected.name} as uploaded`);
  }
  if (typeof body.digest !== 'string' || !body.digest.startsWith('sha256:')) {
    fail('UPLOAD_RESPONSE_DIGEST_UNAVAILABLE', `GitHub did not return a digest for ${expected.name}`, { retryable: true });
  }
  if (!equalDigest(body.digest.slice('sha256:'.length), expected.sha256)) {
    fail('UPLOAD_RESPONSE_DIGEST_MISMATCH', `GitHub returned a different digest for ${expected.name}`);
  }
  return { id: body.id, name: body.name, bytes: body.size, sha256: expected.sha256 };
}

async function openStableUploadBody(filePath, expected) {
  const pathStat = await lstat(filePath);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    fail('INVALID_LOCAL_ASSET', `Release asset must be a regular non-symlink file: ${expected.name}`);
  }
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile()
      || !sameFileIdentity(openedStat, fileIdentity(pathStat))
      || openedStat.size !== expected.bytes) {
      fail('ASSET_CHANGED', `Release asset size changed before upload: ${expected.name}`);
    }

    let closed = false;
    let settled = false;
    let completionError;
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    completion.catch(() => undefined);

    const settleReject = (error) => {
      if (!settled) {
        settled = true;
        completionError = error;
        rejectCompletion(error);
      }
    };
    const closeHandle = async () => {
      if (!closed) {
        closed = true;
        await handle.close().catch(() => undefined);
      }
    };
    const source = async function* stableSource() {
      const digest = createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          if (bytes + chunk.byteLength > openedStat.size) {
            throw new GitHubReleaseUploadError('ASSET_CHANGED', `Release asset grew during upload: ${expected.name}`);
          }
          digest.update(chunk);
          bytes += chunk.byteLength;
          yield chunk;
        }
        const finalStat = await handle.stat();
        const sha256 = digest.digest('hex');
        if (!sameFileIdentity(finalStat, fileIdentity(openedStat))
          || bytes !== expected.bytes
          || !equalDigest(sha256, expected.sha256)) {
          throw new GitHubReleaseUploadError('ASSET_CHANGED', `Release asset changed during upload: ${expected.name}`);
        }
        settled = true;
        resolveCompletion({ bytes, sha256 });
      } catch (error) {
        settleReject(error);
        throw error;
      } finally {
        await closeHandle();
      }
    };
    const body = Readable.from(source());
    body.on('error', settleReject);
    const close = async (reason = new GitHubReleaseUploadError('UPLOAD_ABORTED', `Upload aborted: ${expected.name}`)) => {
      settleReject(reason);
      body.destroy();
      await closeHandle();
    };
    return {
      body,
      completion,
      close,
      get completionError() {
        return completionError;
      },
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw error;
  }
}

async function sendAsset({ url, token, filePath, expected, fetchImpl, timeoutMs, budget }) {
  const stable = await openStableUploadBody(filePath, expected);
  let requestTimeoutMs;
  try {
    requestTimeoutMs = timeoutWithinRetryBudget(timeoutMs, budget);
  } catch (error) {
    await stable.close(error);
    throw error;
  }
  const externalController = new AbortController();
  let completionTimer;
  let failure;
  const completionDeadline = new Promise((_, reject) => {
    completionTimer = setTimeout(() => {
      const error = new FetchDeadlineError(url, requestTimeoutMs);
      externalController.abort(error);
      reject(error);
    }, requestTimeoutMs);
  });
  const request = fetchJsonWithDeadline(url, {
    method: 'POST',
    headers: {
      ...githubApiHeaders(token),
      'content-type': 'application/octet-stream',
      'content-length': String(expected.bytes),
    },
    body: stable.body,
    duplex: 'half',
    signal: externalController.signal,
  }, {
    fetchImpl,
    timeoutMs: requestTimeoutMs,
    maxBytes: MAX_RESPONSE_BYTES,
    includeErrorBody: true,
  });
  request.catch(() => undefined);
  try {
    // A rejected/non-success mutation is already an ambiguous outcome and
    // must be classified immediately. Waiting for the request body to drain
    // here can turn a fast 429/403 into a full upload-timeout on a large or
    // slow stream. Only a successful 201 is allowed to commit after the
    // immutable body has completed and its digest has been verified.
    const response = await Promise.race([request, completionDeadline]);
    if (response.status !== 201) {
      if (stable.completionError) throw stable.completionError;
      return validateUploadResponse({ ...response, expected });
    }
    const streamed = await Promise.race([stable.completion, completionDeadline]);
    if (streamed.bytes !== expected.bytes || !equalDigest(streamed.sha256, expected.sha256)) {
      fail('ASSET_CHANGED', `Release asset digest changed during upload: ${expected.name}`);
    }
    return validateUploadResponse({ ...response, expected });
  } catch (error) {
    // Preserve a source-integrity failure if the request adapter reports a
    // transport error while consuming the same body. The local invariant is
    // more specific and must not be replaced by a generic HTTP error.
    failure = stable.completionError ?? error;
    throw failure;
  } finally {
    clearTimeout(completionTimer);
    if (failure) externalController.abort(failure);
    await stable.close(failure ?? undefined);
  }
}

async function reconcileOwnedDraft({
  apiBase,
  repo,
  tag,
  releaseId,
  sourceSha,
  token,
  localAssets,
  fetchImpl,
  timeoutMs,
  sleep,
  budget,
}) {
  const retryOptions = {
    sleep,
    timeoutMs,
    ...(budget === undefined ? {} : { budget }),
  };
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS + 2; attempt += 1) {
    const release = await fetchReleaseById({
      apiBase, repo, releaseId, token, fetchImpl, retryOptions,
    });
    assertOwnedDraft(release, { repo, tag, releaseId, sourceSha });
    const remoteAssets = await fetchAllRemoteAssets({
      apiBase, repo, releaseId, token, fetchImpl, retryOptions,
    });
    try {
      const plan = planReleaseAssetUploads({ localAssets, remoteAssets, release, tag, sourceSha });
      if (plan.status === 'CLEANUP_REQUIRED') {
        for (const asset of plan.cleanup) {
          await cleanupOwnedStarterAsset({
            apiBase,
            repo,
            tag,
            releaseId,
            sourceSha,
            asset,
            token,
            fetchImpl,
            timeoutMs,
            sleep,
            budget,
          });
        }
        if (attempt === MAX_READ_ATTEMPTS + 2) fail('REMOTE_ASSET_CLEANUP_LOOP', 'Starter asset cleanup did not converge');
        if (budget) await budget.wait(RETRY_DELAYS_MS[0]);
        else await sleep(RETRY_DELAYS_MS[0]);
        continue;
      }
      return { release, remoteAssets, plan };
    } catch (error) {
      if (!(error instanceof GitHubReleaseReconciliationError)
        || error.code !== 'REMOTE_ASSET_DIGEST_UNAVAILABLE'
        || attempt === MAX_READ_ATTEMPTS + 2) throw error;
      if (budget) {
        await budget.wait(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
      } else {
        await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
      }
    }
  }
  fail('RECONCILIATION_FAILED', 'Release asset reconciliation did not converge');
}

async function waitForMutationConvergence(options, assetName) {
  let state;
  for (let attempt = 1; attempt <= MAX_MUTATION_VISIBILITY_ATTEMPTS; attempt += 1) {
    state = await reconcileOwnedDraft(options);
    if (!state.plan.missing.includes(assetName)) return state;
    if (attempt < MAX_MUTATION_VISIBILITY_ATTEMPTS) {
      if (options.budget) {
        await options.budget.wait(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
      } else {
        await options.sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
      }
    }
  }
  return state;
}

/**
 * Low-level release adapter. The production entry point is the CLI, which
 * must load and digest-bind a publication seal before calling this function.
 */
export async function uploadGitHubReleaseAssets({
  apiBase,
  repo,
  tag,
  releaseId,
  sourceSha,
  root,
  publicationSeal = undefined,
  token,
  assets = undefined,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  operationTimeoutMs = DEFAULT_UPLOAD_BUDGET_MS,
  budget = undefined,
}) {
  if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required');
  if (!SAFE_REPOSITORY.test(repo) || !SAFE_TAG.test(tag) || !SAFE_SOURCE_SHA.test(sourceSha)) {
    fail('INVALID_ARGUMENT', 'Repository, tag, or source SHA is invalid');
  }
  if (!positiveReleaseId(releaseId)) fail('INVALID_RELEASE_ID', 'Release id is invalid or exceeds the safe integer range');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail('INVALID_TIMEOUT', 'timeoutMs must be a positive safe integer');
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs <= 0) {
    fail('INVALID_OPERATION_TIMEOUT', 'operationTimeoutMs must be a positive safe integer');
  }
  if (budget !== undefined && !(budget instanceof RetryBudget)) {
    fail('INVALID_RETRY_BUDGET', 'budget must be a RetryBudget');
  }
  const trustedApiBase = normalizeGitHubApiBase(apiBase);
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
  const selected = assets === undefined
    ? localAssets.map((asset) => asset.name)
    : [...new Set(assets)];
  for (const name of selected) {
    if (!SAFE_ASSET_NAME.test(name)) fail('INVALID_ASSET_NAME', `Invalid release asset name: ${name}`);
    findLocalAsset(localAssets, name);
  }
  const localByName = new Map(localAssets.map((asset) => [asset.name, asset]));
  const rootPath = path.resolve(root);
  const uploaded = [];
  const skipped = [];

  for (const name of selected.sort((left, right) => left.localeCompare(right))) {
    const expected = localByName.get(name);
    let completed = false;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      let state;
      let mutationAttempted = false;
      try {
        state = await reconcileOwnedDraft({
          apiBase: trustedApiBase,
          repo,
          tag,
          releaseId,
          sourceSha,
          token,
          localAssets,
          fetchImpl,
          timeoutMs,
          sleep,
          budget: retryBudget,
        });
        if (!state.plan.missing.includes(name)) {
          skipped.push(name);
          completed = true;
          break;
        }
        const filePath = path.join(rootPath, name);
        const url = buildReleaseAssetUploadUrl({
          release: state.release,
          apiBase: trustedApiBase,
          repo,
          releaseId,
          name,
        });
        mutationAttempted = true;
        const uploadTimeoutMs = calculateUploadDeadlineMs(expected.bytes, {
          baseTimeoutMs: timeoutMs,
        });
        await sendAsset({
          url,
          token,
          filePath,
          expected,
          fetchImpl,
          timeoutMs: uploadTimeoutMs,
          budget: retryBudget,
        });
        const afterUpload = await waitForMutationConvergence({
          apiBase: trustedApiBase,
          repo,
          tag,
          releaseId,
          sourceSha,
          token,
          localAssets,
          fetchImpl,
          timeoutMs,
          sleep,
          budget: retryBudget,
        }, name);
        if (afterUpload.plan.missing.includes(name)) {
          fail('UPLOAD_POSTCONDITION_FAILED', `GitHub did not retain the uploaded asset: ${name}`, { retryable: true });
        }
        uploaded.push(name);
        completed = true;
        break;
      } catch (error) {
        const retryable = retryableError(error)
          || (error instanceof GitHubReleaseUploadError && (
            error.retryable || RECONCILABLE_UPLOAD_RESPONSE_CODES.has(error.code)
          ));
        if (!mutationAttempted) {
          if (!retryable || attempt === MAX_UPLOAD_ATTEMPTS) throw error;
          assertProviderDelayWithinBound(
            error,
            DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
            DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
          );
          await retryBudget.wait(calculateGitHubRetryDelay(error, {
            attempt,
            baseDelayMs: RETRY_DELAYS_MS[0],
            maxDelayMs: RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
            maxRateLimitDelayMs: DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
            rateLimitFallbackDelayMs: DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
          }));
          continue;
        }
        if (!mutationOutcomeMayBeAmbiguous(error)) throw error;
        let deferredRetryError = error;
        if (error?.rateLimited === true || Number.isSafeInteger(error?.retryAfterMs)) {
          assertProviderDelayWithinBound(
            error,
            DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
            DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
          );
          await retryBudget.wait(calculateGitHubRetryDelay(error, {
            attempt,
            baseDelayMs: RETRY_DELAYS_MS[0],
            maxDelayMs: RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
            maxRateLimitDelayMs: DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
            rateLimitFallbackDelayMs: DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
          }));
          deferredRetryError = undefined;
        }
        // A POST can commit before its response is lost. Reconcile the exact
        // release id before deciding whether a retry is safe.
        try {
          const afterFailure = await waitForMutationConvergence({
            apiBase: trustedApiBase,
            repo,
            tag,
            releaseId,
            sourceSha,
            token,
            localAssets,
            fetchImpl,
            timeoutMs,
            sleep,
            budget: retryBudget,
          }, name);
          if (!afterFailure.plan.missing.includes(name)) {
            uploaded.push(name);
            completed = true;
            break;
          }
        } catch (reconcileError) {
          if (!retryableError(reconcileError)) throw reconcileError;
          deferredRetryError = reconcileError;
        }
        if (!retryable || attempt === MAX_UPLOAD_ATTEMPTS) throw error;
        if (deferredRetryError) {
          assertProviderDelayWithinBound(
            deferredRetryError,
            DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
            DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
          );
          await retryBudget.wait(calculateGitHubRetryDelay(deferredRetryError, {
            attempt,
            baseDelayMs: RETRY_DELAYS_MS[0],
            maxDelayMs: RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
            maxRateLimitDelayMs: DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
            rateLimitFallbackDelayMs: DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
          }));
        }
      }
    }
    if (!completed) fail('UPLOAD_NOT_COMPLETED', `Release asset upload did not complete: ${name}`);
  }

  return {
    status: uploaded.length === 0 ? 'VERIFIED' : 'UPLOADED',
    releaseId: positiveReleaseId(releaseId),
    uploaded,
    skipped,
  };
}

async function main() {
  try {
    const args = parseUploadArgs(process.argv.slice(2));
    const publicationSeal = await readReleasePublicationSeal(args.seal, {
      sourceSha: args['source-sha'],
      releaseRef: `refs/tags/${args.tag}`,
      sealSha256: args['seal-sha'],
    });
    const result = await uploadGitHubReleaseAssets({
      apiBase: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
      repo: args.repo,
      tag: args.tag,
      releaseId: args['release-id'],
      sourceSha: args['source-sha'],
      root: args.root,
      publicationSeal,
      assets: args.assets.length > 0 ? args.assets : undefined,
      token: process.env.GH_TOKEN,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error?.code ?? 'RELEASE_ASSET_UPLOAD_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
