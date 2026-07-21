#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJsonWithDeadline } from './fetch-deadline.mjs';
import { githubApiHeaders, normalizeGitHubApiBase } from './github-api-base.mjs';
import {
  assertGitHubReadResponse,
  DEFAULT_RETRY_BUDGET_MS,
  RetryBudget,
  timeoutWithinRetryBudget,
  withGitHubReadRetry,
} from './github-read-retry.mjs';
import { hashStableFile, readStableFile } from './stable-file.mjs';
import {
  assertReleasePublicationSealMatchesAssets,
  MAX_RELEASE_PUBLICATION_TOTAL_BYTES,
  readReleasePublicationSeal,
} from './release-publication-seal.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_INSTALLER_ASSETS = 128;
const MAX_PUBLICATION_FILES = MAX_INSTALLER_ASSETS + 2;
const MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_RELEASE_ASSET_TOTAL_BYTES = MAX_RELEASE_PUBLICATION_TOTAL_BYTES;
const ALLOWED_RELEASE_ASSET_EXTENSIONS = Object.freeze(['.dmg', '.exe', '.msi']);
const SAFE_RELEASE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const ALLOWED_PROVENANCE_ASSETS = Object.freeze(new Set([
  'release-assets-manifest.json',
  'release-decision.json',
]));
const MAX_DIGEST_ATTEMPTS = 12;
const DIGEST_RETRY_DELAY_MS = 5_000;
const RELEASE_STATES = Object.freeze(new Set(['draft', 'published']));

export class GitHubReleaseAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubReleaseAssetError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GitHubReleaseAssetError(code, message);
}

function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

async function hashFile(filePath, expectedStat) {
  try {
    return (await hashStableFile(filePath, expectedStat)).sha256;
  } catch (error) {
    if (error?.code === 'FILE_CHANGED') fail('ASSET_CHANGED', `${path.basename(filePath)} changed while hashing`);
    throw error;
  }
}

function validateLocalManifestBinding(assets, manifestBytes) {
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail('INVALID_PROVENANCE_MANIFEST', 'Release asset provenance manifest is not valid JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)
    || manifest.artifacts.length === 0 || manifest.artifacts.length > MAX_INSTALLER_ASSETS) {
    fail('INVALID_PROVENANCE_MANIFEST', 'Release asset provenance manifest has an invalid schema');
  }
  const installerAssets = assets.filter((asset) => ALLOWED_RELEASE_ASSET_EXTENSIONS.some(
    (extension) => asset.name.toLowerCase().endsWith(extension),
  ));
  const expected = new Map();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
      || typeof artifact.name !== 'string' || !SAFE_RELEASE_ASSET_NAME.test(artifact.name)
      || !ALLOWED_RELEASE_ASSET_EXTENSIONS.some((extension) => artifact.name.toLowerCase().endsWith(extension))
      || expected.has(artifact.name)
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0
      || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      fail('INVALID_PROVENANCE_MANIFEST', 'Release asset provenance manifest contains an invalid artifact');
    }
    expected.set(artifact.name, artifact);
  }
  if (expected.size !== installerAssets.length
    || installerAssets.some((asset) => {
      const artifact = expected.get(asset.name);
      return !artifact || artifact.bytes !== asset.bytes || artifact.sha256 !== asset.sha256;
    })) {
    fail('PROVENANCE_MANIFEST_MISMATCH', 'Local release installers differ from the attested provenance manifest');
  }
}

export async function collectLocalReleaseAssets(
  rootPath,
  { requireManifest = false, publicationSeal = undefined } = {},
) {
  const resolvedRoot = path.resolve(rootPath);
  const rootStat = await lstat(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('INVALID_ASSET_ROOT', 'Release asset root must be a regular directory');
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  if (entries.length === 0 || entries.length > MAX_PUBLICATION_FILES) fail('INVALID_ASSET_COUNT', 'Release asset root has an invalid file count');
  const assets = [];
  let totalBytes = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(resolvedRoot, entry.name);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || entry.name.includes('/') || entry.name.includes('\\')) {
      fail('INVALID_RELEASE_ASSET', `Release asset must be a top-level regular file: ${entry.name}`);
    }
    if (stat.size > MAX_RELEASE_ASSET_BYTES) fail('INVALID_ASSET_SIZE', `Release asset is too large: ${entry.name}`);
    totalBytes += stat.size;
    if (totalBytes > MAX_RELEASE_ASSET_TOTAL_BYTES) fail('INVALID_ASSET_SIZE', 'Release asset root exceeds the aggregate byte limit');
    if (!SAFE_RELEASE_ASSET_NAME.test(entry.name)) {
      fail('INVALID_RELEASE_ASSET', `Release asset name contains unsafe characters: ${entry.name}`);
    }
    if (!ALLOWED_PROVENANCE_ASSETS.has(entry.name)
      && !ALLOWED_RELEASE_ASSET_EXTENSIONS.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
      fail('UNEXPECTED_RELEASE_ASSET', `Release asset has an unsupported extension: ${entry.name}`);
    }
    assets.push({ name: entry.name, bytes: stat.size, sha256: await hashFile(absolute, stat) });
  }
  const manifest = assets.find((asset) => asset.name === 'release-assets-manifest.json');
  if (requireManifest && !manifest) fail('PROVENANCE_MANIFEST_MISSING', 'Release publication requires release-assets-manifest.json');
  if (manifest) {
    const manifestPath = path.join(resolvedRoot, manifest.name);
    const manifestStat = await lstat(manifestPath);
    const snapshot = await readStableFile(manifestPath, manifestStat, MAX_RELEASE_ASSET_BYTES);
    const snapshotDigest = createHash('sha256').update(snapshot.bytes).digest('hex');
    if (snapshotDigest !== manifest.sha256 || snapshot.bytes.byteLength !== manifest.bytes) {
      fail('ASSET_CHANGED', 'Release asset provenance manifest changed while being read');
    }
    validateLocalManifestBinding(assets, snapshot.bytes);
  }
  if (publicationSeal) assertReleasePublicationSealMatchesAssets(publicationSeal, assets);
  return assets;
}

function releaseState(release, expectedState) {
  if (!RELEASE_STATES.has(expectedState)) {
    fail('INVALID_EXPECTED_STATE', 'Expected release state must be draft or published');
  }
  if (typeof release.draft !== 'boolean') {
    fail('INVALID_RELEASE_STATE', 'Remote release has no valid draft state');
  }
  const actualState = release.draft ? 'draft' : 'published';
  if (actualState !== expectedState) {
    const code = expectedState === 'draft' ? 'RELEASE_NOT_DRAFT' : 'RELEASE_NOT_PUBLISHED';
    fail(code, `Remote release must be ${expectedState} during verification`);
  }
  return actualState;
}

export function validateRemoteReleaseAssets({ expectedState, localAssets, release, remoteAssets }) {
  if (!release || typeof release !== 'object' || !Number.isSafeInteger(release.id) || release.id <= 0) {
    fail('INVALID_RELEASE', 'Remote release has no valid id');
  }
  const actualState = releaseState(release, expectedState);
  if (!Array.isArray(localAssets) || !Array.isArray(remoteAssets)) fail('INVALID_ASSET_SET', 'Asset sets must be arrays');
  if (remoteAssets.length > localAssets.length) fail('REMOTE_ASSET_SET_MISMATCH', 'Remote release contains more assets than the local set');

  const expectedByName = new Map(localAssets.map((asset) => [asset.name, asset]));
  if (expectedByName.size !== localAssets.length) fail('DUPLICATE_LOCAL_ASSET', 'Local release asset names are not unique');
  const seen = new Set();
  for (const remote of remoteAssets) {
    if (!remote || typeof remote.name !== 'string' || seen.has(remote.name)) fail('DUPLICATE_REMOTE_ASSET', 'Remote release asset names are invalid or duplicated');
    seen.add(remote.name);
    const expected = expectedByName.get(remote.name);
    if (!expected) fail('UNEXPECTED_REMOTE_ASSET', `Remote release contains unexpected asset ${remote.name}`);
    if (!Number.isSafeInteger(remote.id) || remote.id <= 0) {
      fail('REMOTE_ASSET_ID_UNAVAILABLE', `Remote release asset has no immutable id: ${remote.name}`);
    }
    if (remote.state !== 'uploaded') {
      fail('REMOTE_ASSET_NOT_UPLOADED', `Remote release asset is not uploaded: ${remote.name}`);
    }
    if (remote.size !== expected.bytes) fail('REMOTE_ASSET_SIZE_MISMATCH', `Remote release asset size differs for ${remote.name}`);
    if (typeof remote.digest !== 'string' || !remote.digest.startsWith('sha256:')) {
      fail('REMOTE_ASSET_DIGEST_UNAVAILABLE', `Remote release asset digest is unavailable for ${remote.name}`);
    }
    if (!equalDigest(remote.digest.slice('sha256:'.length), expected.sha256)) {
      fail('REMOTE_ASSET_DIGEST_MISMATCH', `Remote release asset digest differs for ${remote.name}`);
    }
  }
  if (seen.size < expectedByName.size) {
    fail('REMOTE_ASSET_SET_INCOMPLETE', 'Remote release asset set is not yet complete');
  }
  return {
    status: 'VERIFIED',
    releaseId: release.id,
    state: actualState,
    assets: localAssets.length,
  };
}

export function parseReleaseAssetArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) fail('INVALID_ARGUMENT', `Invalid argument near ${flag ?? '<end>'}`);
    const key = flag.slice(2);
    if (!['root', 'repo', 'tag', 'release-id', 'source-sha', 'expected-state', 'seal', 'seal-sha'].includes(key) || Object.hasOwn(values, key)) {
      fail('INVALID_ARGUMENT', `Unexpected argument ${flag}`);
    }
    values[key] = value;
  }
  for (const key of ['root', 'repo', 'tag', 'release-id', 'source-sha', 'expected-state', 'seal', 'seal-sha']) {
    if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo)) fail('INVALID_ARGUMENT', '--repo is invalid');
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(values.tag)) fail('INVALID_ARGUMENT', '--tag is invalid');
  if (!/^[1-9][0-9]*$/.test(values['release-id'])) fail('INVALID_ARGUMENT', '--release-id is invalid');
  if (!/^[0-9a-f]{40}$/.test(values['source-sha'])) fail('INVALID_ARGUMENT', '--source-sha is invalid');
  if (!/^[0-9a-f]{64}$/.test(values['seal-sha'])) fail('INVALID_ARGUMENT', '--seal-sha is invalid');
  if (!RELEASE_STATES.has(values['expected-state'])) fail('INVALID_ARGUMENT', '--expected-state must be draft or published');
  return values;
}

export async function apiJson(url, token, fetchImpl = fetch, retryOptions = {}) {
  return withGitHubReadRetry(async () => {
    const requestTimeoutMs = timeoutWithinRetryBudget(
      retryOptions.timeoutMs,
      retryOptions.budget,
    );
    const response = await fetchJsonWithDeadline(url, {
      headers: githubApiHeaders(token),
    }, {
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      includeErrorBody: true,
    });
    return assertGitHubReadResponse(response, url);
  }, retryOptions);
}

export async function fetchReleaseById({
  apiBase,
  repo,
  releaseId,
  token,
  fetchImpl = fetch,
  retryOptions = {},
}) {
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const release = await apiJson(
    `${normalizedApiBase}/repos/${repo}/releases/${releaseId}`,
    token,
    fetchImpl,
    retryOptions,
  );
  if (!release || typeof release !== 'object' || String(release.id) !== String(releaseId)) {
    fail('RELEASE_ID_MISMATCH', 'GitHub returned a different release id');
  }
  return release;
}

export async function fetchReleaseAssetById({
  apiBase,
  repo,
  assetId,
  token,
  fetchImpl = fetch,
  retryOptions = {},
}) {
  const assetIdText = String(assetId ?? '');
  if (!/^[1-9][0-9]*$/.test(assetIdText)
    || !Number.isSafeInteger(Number(assetIdText))) {
    fail('INVALID_ASSET_ID', 'Release asset id must be a safe positive integer');
  }
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const asset = await apiJson(
    `${normalizedApiBase}/repos/${repo}/releases/assets/${assetIdText}`,
    token,
    fetchImpl,
    retryOptions,
  );
  if (!asset || typeof asset !== 'object' || String(asset.id) !== assetIdText) {
    fail('REMOTE_ASSET_ID_MISMATCH', 'GitHub returned a different release asset id');
  }
  return asset;
}

export async function fetchAllRemoteAssets({
  apiBase,
  repo,
  releaseId,
  token,
  fetchImpl = fetch,
  retryOptions = {},
}) {
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const assets = [];
  for (let page = 1; page <= 2; page += 1) {
    const batch = await apiJson(
      `${normalizedApiBase}/repos/${repo}/releases/${releaseId}/assets?per_page=100&page=${page}`,
      token,
      fetchImpl,
      retryOptions,
    );
    if (!Array.isArray(batch)) fail('GITHUB_API_FAILED', 'GitHub release assets response is not an array');
    assets.push(...batch);
    if (batch.length < 100) return assets;
  }
  fail('INVALID_ASSET_COUNT', 'Remote release contains more than 200 assets');
}

/**
 * Low-level release adapter. The production entry point is the CLI, which
 * must load and digest-bind a publication seal before calling this function.
 */
export async function verifyGitHubReleaseAssets({
  expectedState,
  localAssets,
  publicationSeal = undefined,
  releaseId,
  tag,
  sourceSha,
  apiBase,
  repo,
  token,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  operationTimeoutMs = DEFAULT_RETRY_BUDGET_MS,
  budget = undefined,
}) {
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs <= 0) {
    fail('INVALID_OPERATION_TIMEOUT', 'operationTimeoutMs must be a positive safe integer');
  }
  if (budget !== undefined && !(budget instanceof RetryBudget)) {
    fail('INVALID_RETRY_BUDGET', 'budget must be a RetryBudget');
  }
  if (publicationSeal) {
    assertReleasePublicationSealMatchesAssets(publicationSeal, localAssets, {
      sourceSha,
      releaseRef: `refs/tags/${tag}`,
    });
  }
  const retryBudget = budget ?? new RetryBudget({ timeoutMs: operationTimeoutMs, sleep });
  let lastError;
  for (let attempt = 1; attempt <= MAX_DIGEST_ATTEMPTS; attempt += 1) {
    const retryOptions = { sleep, timeoutMs: 30_000, budget: retryBudget };
    const release = await fetchReleaseById({
      apiBase, repo, releaseId, token, fetchImpl, retryOptions,
    });
    if (release.tag_name !== tag) fail('RELEASE_TAG_MISMATCH', 'GitHub returned a different release tag');
    if (typeof release.body !== 'string'
      || !release.body.includes(`<!-- junqi-release-source-sha: ${sourceSha} -->`)) {
      fail('RELEASE_OWNERSHIP_MISMATCH', 'GitHub release does not carry this source transaction marker');
    }
    const remoteAssets = await fetchAllRemoteAssets({
      apiBase, repo, releaseId: release.id, token, fetchImpl, retryOptions,
    });
    try {
      return validateRemoteReleaseAssets({ expectedState, localAssets, release, remoteAssets });
    } catch (error) {
      lastError = error;
      if (!(error instanceof GitHubReleaseAssetError)
        || ![
          'REMOTE_ASSET_DIGEST_UNAVAILABLE',
          'REMOTE_ASSET_NOT_UPLOADED',
          'REMOTE_ASSET_SET_INCOMPLETE',
          'RELEASE_NOT_PUBLISHED',
        ].includes(error.code)
        || (error.code === 'RELEASE_NOT_PUBLISHED' && expectedState !== 'published')
        || attempt === MAX_DIGEST_ATTEMPTS) throw error;
      await retryBudget.wait(DIGEST_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function main() {
  try {
    const args = parseReleaseAssetArgs(process.argv.slice(2));
    const token = process.env.GH_TOKEN;
    if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required');
    const apiBase = normalizeGitHubApiBase(process.env.GITHUB_API_URL || 'https://api.github.com');
    const publicationSeal = await readReleasePublicationSeal(args.seal, {
      sourceSha: args['source-sha'],
      releaseRef: `refs/tags/${args.tag}`,
      sealSha256: args['seal-sha'],
    });
    const localAssets = await collectLocalReleaseAssets(args.root, {
      requireManifest: true,
      publicationSeal,
    });
    const result = await verifyGitHubReleaseAssets({
      expectedState: args['expected-state'],
      localAssets,
      publicationSeal,
      releaseId: args['release-id'],
      tag: args.tag,
      sourceSha: args['source-sha'],
      apiBase,
      repo: args.repo,
      token,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error?.code ?? 'RELEASE_ASSET_VERIFICATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
