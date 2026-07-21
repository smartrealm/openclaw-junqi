#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FetchDeadlineError,
  FetchResponseError,
  FetchTransportError,
  fetchJsonWithDeadline,
} from './fetch-deadline.mjs';
import { githubApiHeaders, normalizeGitHubApiBase } from './github-api-base.mjs';
import {
  assertProviderDelayWithinBound,
  calculateGitHubRetryDelay,
  DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
  DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
  DEFAULT_RETRY_BUDGET_MS,
  rateLimitMetadata,
  RetryBudget,
  timeoutWithinRetryBudget,
} from './github-read-retry.mjs';
import { inspectGitHubRelease } from './inspect-github-release.mjs';
import { fetchReleaseById } from './verify-github-release-assets.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MUTATION_BUDGET_MS = DEFAULT_RETRY_BUDGET_MS;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 8 * 1024;
const MAX_RELEASE_BODY_BYTES = 1024 * 1024;
const MAX_TITLE_BYTES = 256;
const MAX_MUTATION_ATTEMPTS = 3;
const MAX_CREATE_ID_RECONCILIATION_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 5_000;
const RETRYABLE_HTTP_STATUSES = Object.freeze(new Set([408, 425, 429, 500, 502, 503, 504]));
const TERMINAL_RELEASE_IDENTITY_CODES = Object.freeze(new Set([
  'RELEASE_OWNERSHIP_MISMATCH',
  'RELEASE_TAG_MISMATCH',
  'RELEASE_ID_MISMATCH',
]));
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_TAG = /^v[0-9A-Za-z][0-9A-Za-z._-]*$/;
const SAFE_SOURCE_SHA = /^[0-9a-f]{40}$/;
const SAFE_RELEASE_ID = /^[1-9][0-9]*$/;
const MAX_SAFE_RELEASE_ID = Number.MAX_SAFE_INTEGER;

function retryMetadata(error) {
  return {
    ...(Number.isSafeInteger(error?.status) ? { status: error.status } : {}),
    ...(Number.isSafeInteger(error?.retryAfterMs) ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(error?.rateLimited === true ? { rateLimited: true } : {}),
    ...(Number.isSafeInteger(error?.rateLimitRemaining)
      ? { rateLimitRemaining: error.rateLimitRemaining }
      : {}),
    ...(Number.isSafeInteger(error?.rateLimitResetAfterMs)
      ? { rateLimitResetAfterMs: error.rateLimitResetAfterMs }
      : {}),
  };
}

/**
 * Errors from this adapter carry whether a remote write may have committed.
 * Callers must reconcile an ambiguous error before attempting another write.
 */
export class GitHubReleaseMutationError extends Error {
  constructor(
    code,
    message,
    {
      operation = undefined,
      retryable = false,
      ambiguous = false,
      status = undefined,
      retryAfterMs = undefined,
      rateLimited = false,
      rateLimitRemaining = undefined,
      rateLimitResetAfterMs = undefined,
      releaseId = undefined,
      cause = undefined,
    } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GitHubReleaseMutationError';
    this.code = code;
    this.operation = operation;
    this.retryable = retryable === true;
    this.ambiguous = ambiguous === true;
    if (Number.isSafeInteger(status)) this.status = status;
    if (Number.isSafeInteger(retryAfterMs)) this.retryAfterMs = retryAfterMs;
    if (rateLimited === true) this.rateLimited = true;
    if (Number.isSafeInteger(rateLimitRemaining)) this.rateLimitRemaining = rateLimitRemaining;
    if (Number.isSafeInteger(rateLimitResetAfterMs)) this.rateLimitResetAfterMs = rateLimitResetAfterMs;
    if (Number.isSafeInteger(releaseId)) this.releaseId = releaseId;
  }
}

function fail(code, message, options = undefined) {
  throw new GitHubReleaseMutationError(code, message, options);
}

function positiveReleaseId(value) {
  const text = String(value ?? '');
  if (!SAFE_RELEASE_ID.test(text)) return undefined;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) && numeric <= MAX_SAFE_RELEASE_ID ? numeric : undefined;
}

export function sourceMarker(sourceSha) {
  return `<!-- junqi-release-source-sha: ${sourceSha} -->`;
}

function validateRepository(value) {
  if (typeof value !== 'string' || !SAFE_REPOSITORY.test(value)) {
    fail('INVALID_ARGUMENT', '--repo is invalid');
  }
  return value;
}

function validateTag(value) {
  if (typeof value !== 'string' || !SAFE_TAG.test(value)) fail('INVALID_ARGUMENT', '--tag is invalid');
  return value;
}

function validateSourceSha(value) {
  if (typeof value !== 'string' || !SAFE_SOURCE_SHA.test(value)) {
    fail('INVALID_ARGUMENT', '--source-sha is invalid');
  }
  return value;
}

function validateReleaseId(value) {
  const id = positiveReleaseId(value);
  if (id === undefined) fail('INVALID_ARGUMENT', '--release-id is invalid or exceeds the safe integer range');
  return id;
}

function validateTitle(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('INVALID_ARGUMENT', '--title must be a non-empty single-line string');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_TITLE_BYTES) {
    fail('INVALID_ARGUMENT', `--title exceeds the ${MAX_TITLE_BYTES}-byte limit`);
  }
  return value;
}

function validateOperationTimeout(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizeRelease(
  body,
  {
    tag,
    sourceSha,
    releaseId = undefined,
    expectedDraft = undefined,
    operation,
    responseMayBeAmbiguous = false,
  },
) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('RELEASE_RESPONSE_INVALID', 'GitHub returned an invalid release object', {
      operation,
      ambiguous: true,
      retryable: true,
      releaseId,
    });
  }
  const actualId = positiveReleaseId(body.id);
  if (actualId === undefined) {
    fail('RELEASE_RESPONSE_ID_INVALID', 'GitHub release has no valid immutable id', {
      operation,
      ambiguous: true,
      retryable: true,
      releaseId,
    });
  }
  if (releaseId !== undefined && actualId !== releaseId) {
    fail('RELEASE_ID_MISMATCH', 'GitHub returned a different release id', {
      operation,
      ambiguous: true,
      retryable: responseMayBeAmbiguous,
      releaseId: actualId,
    });
  }
  if (body.tag_name !== tag) {
    fail('RELEASE_TAG_MISMATCH', 'GitHub returned a different release tag', {
      operation,
      ambiguous: true,
      retryable: responseMayBeAmbiguous,
      releaseId: actualId,
    });
  }
  if (typeof body.draft !== 'boolean') {
    fail('RELEASE_STATE_INVALID', 'GitHub release has no valid draft state', {
      operation,
      ambiguous: true,
      retryable: true,
      releaseId: actualId,
    });
  }
  if (expectedDraft !== undefined && body.draft !== expectedDraft) {
    fail('RELEASE_STATE_MISMATCH', `GitHub release is not ${expectedDraft ? 'a draft' : 'published'}`, {
      operation,
      ambiguous: true,
      retryable: true,
      releaseId: actualId,
    });
  }
  if (typeof body.body !== 'string' || Buffer.byteLength(body.body, 'utf8') > MAX_RELEASE_BODY_BYTES) {
    fail('RELEASE_BODY_INVALID', 'GitHub release body is invalid or exceeds the bounded response size', {
      operation,
      ambiguous: true,
      retryable: true,
      releaseId: actualId,
    });
  }
  if (!body.body.includes(sourceMarker(sourceSha))) {
    fail('RELEASE_OWNERSHIP_MISMATCH', 'GitHub release does not carry this source transaction marker', {
      operation,
      ambiguous: responseMayBeAmbiguous,
      retryable: responseMayBeAmbiguous,
      releaseId: actualId,
    });
  }
  return Object.freeze({
    id: actualId,
    tagName: body.tag_name,
    draft: body.draft,
    body: body.body,
  });
}

function normalizeInspection(result, { tag, sourceSha, operation }) {
  if (result?.status !== 'PRESENT') return result;
  const release = normalizeRelease({
    id: result.release?.id,
    tag_name: tag,
    draft: result.release?.draft,
    body: result.release?.body,
  }, { tag, sourceSha, operation });
  return { status: 'PRESENT', release };
}

function mutationUrl(apiBase, repo, releaseId = undefined) {
  const suffix = releaseId === undefined
    ? `/repos/${repo}/releases`
    : `/repos/${repo}/releases/${releaseId}`;
  return `${apiBase}${suffix}`;
}

function retryableTransport(error) {
  return error instanceof FetchDeadlineError
    || error instanceof FetchTransportError
    || error?.code === 'FETCH_TIMEOUT'
    || error?.code === 'FETCH_TRANSPORT_ERROR';
}

function mutationErrorFromTransport(error, { operation, url }) {
  if (error instanceof GitHubReleaseMutationError) return error;
  if (retryableTransport(error)) {
    return new GitHubReleaseMutationError(
      error instanceof FetchDeadlineError ? 'MUTATION_TIMEOUT' : 'MUTATION_TRANSPORT_ERROR',
      `GitHub ${operation} request did not produce a complete response: ${url}`,
      { operation, retryable: true, ambiguous: true, cause: error },
    );
  }
  if (error instanceof FetchResponseError) {
    return new GitHubReleaseMutationError(
      'MUTATION_RESPONSE_INVALID',
      `GitHub ${operation} response could not be consumed safely: ${error.message}`,
      { operation, retryable: true, ambiguous: true, cause: error },
    );
  }
  return error;
}

async function requestMutation({
  operation,
  method,
  apiBase,
  repo,
  releaseId,
  token,
  body,
  expectedStatus,
  fetchImpl,
  timeoutMs,
  budget,
}) {
  if (!Number.isSafeInteger(expectedStatus) || expectedStatus < 200 || expectedStatus > 299) {
    throw new TypeError('expectedStatus must be a successful HTTP status');
  }
  const url = mutationUrl(apiBase, repo, releaseId);
  let response;
  try {
    const requestTimeoutMs = timeoutWithinRetryBudget(timeoutMs, budget, DEFAULT_REQUEST_TIMEOUT_MS);
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    if (encodedBody !== undefined && Buffer.byteLength(encodedBody, 'utf8') > MAX_RESPONSE_BYTES) {
      fail('REQUEST_TOO_LARGE', 'GitHub mutation request exceeds the bounded payload size', { operation });
    }
    response = await fetchJsonWithDeadline(url, {
      method,
      headers: {
        ...githubApiHeaders(token),
        'content-type': 'application/json',
      },
      ...(encodedBody === undefined ? {} : { body: encodedBody }),
    }, {
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      includeErrorBody: true,
      maxErrorBytes: MAX_ERROR_BODY_BYTES,
    });
  } catch (error) {
    throw mutationErrorFromTransport(error, { operation, url });
  }

  if (!response?.ok) {
    const metadata = rateLimitMetadata(response?.headers, response?.status, Date.now(), response?.body);
    const status = response?.status;
    const retryable = RETRYABLE_HTTP_STATUSES.has(status) || metadata.rateLimited;
    const ambiguous = retryable || status === 409 || status === 422;
    throw new GitHubReleaseMutationError(
      `${operation.toUpperCase()}_REJECTED`,
      `GitHub ${operation} returned HTTP ${status ?? 'an invalid status'}`,
      {
        operation,
        retryable,
        ambiguous,
        status,
        retryAfterMs: metadata.retryAfterMs,
        rateLimited: metadata.rateLimited,
        rateLimitRemaining: metadata.rateLimitRemaining,
        rateLimitResetAfterMs: metadata.rateLimitResetAfterMs,
        releaseId,
      },
    );
  }
  if (response.status !== expectedStatus) {
    throw new GitHubReleaseMutationError(
      'MUTATION_RESPONSE_STATUS',
      `GitHub ${operation} returned HTTP ${response.status}; expected HTTP ${expectedStatus}`,
      {
        operation,
        retryable: true,
        ambiguous: true,
        status: response.status,
        releaseId,
      },
    );
  }
  return response;
}

function assertMutationRetryDelay(error) {
  assertProviderDelayWithinBound(
    error,
    DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
    DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
  );
  return calculateGitHubRetryDelay(error, {
    attempt: error.attempt ?? 1,
    baseDelayMs: RETRY_BASE_DELAY_MS,
    maxDelayMs: RETRY_MAX_DELAY_MS,
    maxRateLimitDelayMs: DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
    rateLimitFallbackDelayMs: DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
  });
}

async function waitMutationRetry(error, attempt, { budget, sleep }) {
  const retryError = Object.create(error);
  retryError.attempt = attempt;
  const delayMs = assertMutationRetryDelay(retryError);
  if (budget) await budget.wait(delayMs, 'the next GitHub release mutation');
  else await sleep(delayMs);
}

function shouldReconcile(error) {
  return error instanceof GitHubReleaseMutationError && error.ambiguous === true;
}

function isTerminalReleaseIdentityError(error) {
  return error instanceof GitHubReleaseMutationError
    && TERMINAL_RELEASE_IDENTITY_CODES.has(error.code);
}

function candidateReleaseId(error, body) {
  const fromError = positiveReleaseId(error?.releaseId);
  if (fromError !== undefined) return fromError;
  return positiveReleaseId(body?.id);
}

async function inspectByTag({
  apiBase,
  repo,
  tag,
  sourceSha,
  token,
  fetchImpl,
  sleep,
  budget,
  waitForPresent,
}) {
  try {
    const result = await inspectGitHubRelease({
      apiBase,
      repo,
      tag,
      token,
      fetchImpl,
      sleep,
      waitForPresent,
      budget,
      operationTimeoutMs: (() => {
        const remaining = budget?.remainingMs?.();
        return Number.isSafeInteger(remaining) && remaining > 0
          ? remaining
          : DEFAULT_MUTATION_BUDGET_MS;
      })(),
    });
    return normalizeInspection(result, { tag, sourceSha, operation: 'create' });
  } catch (error) {
    if (error instanceof GitHubReleaseMutationError) throw error;
    throw new GitHubReleaseMutationError(
      waitForPresent ? 'CREATE_RECONCILIATION_FAILED' : 'RELEASE_LOOKUP_FAILED',
      `GitHub release identity reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        operation: 'create',
        ambiguous: true,
        retryable: true,
        cause: error,
        ...retryMetadata(error),
      },
    );
  }
}

async function fetchOwnedById({
  apiBase,
  repo,
  tag,
  releaseId,
  sourceSha,
  token,
  fetchImpl,
  sleep,
  budget,
  operation,
}) {
  let release;
  try {
    release = await fetchReleaseById({
      apiBase,
      repo,
      releaseId,
      token,
      fetchImpl,
      retryOptions: {
        fetchImpl,
        sleep,
        timeoutMs: timeoutWithinRetryBudget(undefined, budget, DEFAULT_REQUEST_TIMEOUT_MS),
        budget,
      },
    });
  } catch (error) {
    if (error instanceof GitHubReleaseMutationError) throw error;
    if (error?.code === 'RELEASE_ID_MISMATCH') {
      throw new GitHubReleaseMutationError(
        'RELEASE_ID_MISMATCH',
        'GitHub returned a different release id',
        { operation, ambiguous: false, retryable: false, releaseId },
      );
    }
    throw new GitHubReleaseMutationError(
      'RELEASE_RECONCILIATION_FAILED',
      `GitHub release-id reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        operation,
        ambiguous: true,
        retryable: true,
        releaseId,
        cause: error,
        ...retryMetadata(error),
      },
    );
  }
  return normalizeRelease(release, { tag, sourceSha, releaseId, operation });
}

async function reconcileCreate({
  apiBase,
  repo,
  tag,
  sourceSha,
  token,
  fetchImpl,
  sleep,
  budget,
  candidateId,
}) {
  if (candidateId !== undefined) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_CREATE_ID_RECONCILIATION_ATTEMPTS; attempt += 1) {
      try {
        return await fetchOwnedById({
          apiBase,
          repo,
          tag,
          releaseId: candidateId,
          sourceSha,
          token,
          fetchImpl,
          sleep,
          budget,
          operation: 'create',
        });
      } catch (error) {
        if (isTerminalReleaseIdentityError(error)) throw error;
        lastError = error;
        if (attempt < MAX_CREATE_ID_RECONCILIATION_ATTEMPTS) {
          await waitMutationRetry(error, attempt, { budget, sleep });
        }
      }
    }
    throw new GitHubReleaseMutationError(
      'CREATE_RECONCILIATION_FAILED',
      `GitHub release candidate ${candidateId} did not become readable within the bounded reconciliation window`,
      {
        operation: 'create',
        ambiguous: true,
        retryable: false,
        releaseId: candidateId,
        cause: lastError,
        ...retryMetadata(lastError),
      },
    );
  }
  const result = await inspectByTag({
    apiBase,
    repo,
    tag,
    sourceSha,
    token,
    fetchImpl,
    sleep,
    budget,
    waitForPresent: true,
  });
  if (result.status !== 'PRESENT') {
    fail('CREATE_RECONCILIATION_ABSENT', 'Ambiguous release creation did not produce a visible release', {
      operation: 'create',
      ambiguous: true,
      retryable: false,
    });
  }
  return result.release;
}

function releaseResult(release, { action, operation }) {
  return Object.freeze({
    status: release.draft ? 'DRAFT' : 'PUBLISHED',
    action,
    operation,
    state: release.draft ? 'draft' : 'published',
    releaseId: release.id,
    release,
  });
}

export async function createGitHubRelease({
  apiBase,
  repo,
  tag,
  title,
  sourceSha,
  token,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  operationTimeoutMs = DEFAULT_MUTATION_BUDGET_MS,
  budget = undefined,
}) {
  validateRepository(repo);
  validateTag(tag);
  validateTitle(title);
  validateSourceSha(sourceSha);
  validateOperationTimeout(timeoutMs, 'timeoutMs');
  validateOperationTimeout(operationTimeoutMs, 'operationTimeoutMs');
  if (budget !== undefined && !(budget instanceof RetryBudget)) throw new TypeError('budget must be a RetryBudget');
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const retryBudget = budget ?? new RetryBudget({ timeoutMs: operationTimeoutMs, sleep });

  const preflight = await inspectByTag({
    apiBase: normalizedApiBase,
    repo,
    tag,
    sourceSha,
    token,
    fetchImpl,
    sleep,
    budget: retryBudget,
    waitForPresent: false,
  });
  if (preflight.status === 'PRESENT') {
    return releaseResult(preflight.release, { action: 'RESUMED', operation: 'create' });
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
    let responseBody;
    try {
      const response = await requestMutation({
        operation: 'create',
        method: 'POST',
        apiBase: normalizedApiBase,
        repo,
        token,
        body: {
          tag_name: tag,
          name: title,
          body: sourceMarker(sourceSha),
          draft: true,
          generate_release_notes: true,
        },
        expectedStatus: 201,
        fetchImpl,
        timeoutMs,
        budget: retryBudget,
      });
      responseBody = response.body;
      const release = normalizeRelease(responseBody, {
        tag,
        sourceSha,
        expectedDraft: true,
        operation: 'create',
        responseMayBeAmbiguous: true,
      });
      return releaseResult(release, { action: 'CREATED', operation: 'create' });
    } catch (error) {
      lastError = error;
      if (!shouldReconcile(error)) throw error;

      if (error.rateLimited === true || Number.isSafeInteger(error.retryAfterMs)) {
        await waitMutationRetry(error, attempt, { budget: retryBudget, sleep });
      }
      let reconciled;
      try {
        reconciled = await reconcileCreate({
          apiBase: normalizedApiBase,
          repo,
          tag,
          sourceSha,
          token,
          fetchImpl,
          sleep,
          budget: retryBudget,
          candidateId: candidateReleaseId(error, responseBody),
        });
      } catch (reconcileError) {
        // A visibility timeout means that a second POST could create a
        // duplicate. Preserve the original mutation error and fail closed.
        if (reconcileError.code === 'CREATE_RECONCILIATION_FAILED'
          || reconcileError.code === 'CREATE_RECONCILIATION_ABSENT') {
          throw new GitHubReleaseMutationError(
            'CREATE_AMBIGUOUS_UNRESOLVED',
            `GitHub release creation outcome is ambiguous and could not be reconciled: ${reconcileError.message}`,
            { operation: 'create', ambiguous: true, retryable: false, cause: lastError },
          );
        }
        throw reconcileError;
      }
      return releaseResult(reconciled, { action: 'RECONCILED', operation: 'create' });
    }
  }
  throw lastError;
}

export async function publishGitHubRelease({
  apiBase,
  repo,
  tag,
  releaseId,
  sourceSha,
  token,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  operationTimeoutMs = DEFAULT_MUTATION_BUDGET_MS,
  budget = undefined,
}) {
  validateRepository(repo);
  validateTag(tag);
  const id = validateReleaseId(releaseId);
  validateSourceSha(sourceSha);
  validateOperationTimeout(timeoutMs, 'timeoutMs');
  validateOperationTimeout(operationTimeoutMs, 'operationTimeoutMs');
  if (budget !== undefined && !(budget instanceof RetryBudget)) throw new TypeError('budget must be a RetryBudget');
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const retryBudget = budget ?? new RetryBudget({ timeoutMs: operationTimeoutMs, sleep });

  let release = await fetchOwnedById({
    apiBase: normalizedApiBase,
    repo,
    tag,
    releaseId: id,
    sourceSha,
    token,
    fetchImpl,
    sleep,
    budget: retryBudget,
    operation: 'publish',
  });
  if (!release.draft) return releaseResult(release, { action: 'RESUMED', operation: 'publish' });

  let lastError;
  for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await requestMutation({
        operation: 'publish',
        method: 'PATCH',
        apiBase: normalizedApiBase,
        repo,
        releaseId: id,
        token,
        body: { draft: false },
        expectedStatus: 200,
        fetchImpl,
        timeoutMs,
        budget: retryBudget,
      });
      release = normalizeRelease(response.body, {
        tag,
        sourceSha,
        releaseId: id,
        expectedDraft: false,
        operation: 'publish',
        responseMayBeAmbiguous: true,
      });
      return releaseResult(release, { action: 'PUBLISHED', operation: 'publish' });
    } catch (error) {
      lastError = error;
      if (!shouldReconcile(error)) throw error;
      let providerDelayWaited = false;
      if (error.rateLimited === true || Number.isSafeInteger(error.retryAfterMs)) {
        await waitMutationRetry(error, attempt, { budget: retryBudget, sleep });
        providerDelayWaited = true;
      }
      try {
        release = await fetchOwnedById({
          apiBase: normalizedApiBase,
          repo,
          tag,
          releaseId: id,
          sourceSha,
          token,
          fetchImpl,
          sleep,
          budget: retryBudget,
          operation: 'publish',
        });
      } catch (reconcileError) {
        if (isTerminalReleaseIdentityError(reconcileError)) throw reconcileError;
        throw new GitHubReleaseMutationError(
          'PUBLISH_AMBIGUOUS_UNRESOLVED',
          `GitHub release publication outcome is ambiguous and could not be reconciled: ${reconcileError.message}`,
          { operation: 'publish', ambiguous: true, retryable: false, releaseId: id, cause: reconcileError },
        );
      }
      if (!release.draft) return releaseResult(release, { action: 'RECONCILED', operation: 'publish' });
      if (!error.retryable || attempt === MAX_MUTATION_ATTEMPTS) throw error;
      if (!providerDelayWaited) await waitMutationRetry(error, attempt, { budget: retryBudget, sleep });
    }
  }
  throw lastError;
}

export function parseReleaseMutationArgs(argv) {
  if (!Array.isArray(argv) || argv.length < 1) {
    fail('INVALID_ARGUMENT', 'Usage: <create|publish> --repo <owner/name> --tag <vX> ...');
  }
  const operation = argv[0];
  if (operation !== 'create' && operation !== 'publish') fail('INVALID_ARGUMENT', 'Operation must be create or publish');
  const values = { operation };
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) {
      fail('INVALID_ARGUMENT', `Invalid argument near ${flag ?? '<end>'}`);
    }
    const key = flag.slice(2);
    const allowed = operation === 'create'
      ? ['repo', 'tag', 'title', 'source-sha']
      : ['repo', 'tag', 'release-id', 'source-sha'];
    if (!allowed.includes(key) || Object.hasOwn(values, key)) fail('INVALID_ARGUMENT', `Unexpected argument ${flag}`);
    values[key] = value;
  }
  for (const key of operation === 'create'
    ? ['repo', 'tag', 'title', 'source-sha']
    : ['repo', 'tag', 'release-id', 'source-sha']) {
    if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  }
  validateRepository(values.repo);
  validateTag(values.tag);
  validateSourceSha(values['source-sha']);
  if (operation === 'create') validateTitle(values.title);
  else validateReleaseId(values['release-id']);
  return values;
}

async function main() {
  try {
    const args = parseReleaseMutationArgs(process.argv.slice(2));
    const token = process.env.GH_TOKEN;
    if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required');
    const common = {
      apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
      repo: args.repo,
      tag: args.tag,
      sourceSha: args['source-sha'],
      token,
    };
    const result = args.operation === 'create'
      ? await createGitHubRelease({ ...common, title: args.title })
      : await publishGitHubRelease({ ...common, releaseId: args['release-id'] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof GitHubReleaseMutationError ? error.code : 'RELEASE_MUTATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
      operation: error?.operation,
      releaseId: error?.releaseId,
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
