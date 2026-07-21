#!/usr/bin/env node

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

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 10;
const MAX_RELEASE_BODY_BYTES = 1024 * 1024;
const VISIBILITY_ATTEMPTS = 4;
const VISIBILITY_BASE_DELAY_MS = 1_000;

export class GitHubReleaseInspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubReleaseInspectionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GitHubReleaseInspectionError(code, message);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) fail('INVALID_ARGUMENT', `Invalid argument near ${flag ?? '<end>'}`);
    const key = flag.slice(2);
    if (!['repo', 'tag', 'wait-for-present'].includes(key) || Object.hasOwn(values, key)) fail('INVALID_ARGUMENT', `Unexpected argument ${flag}`);
    values[key] = value;
  }
  for (const key of ['repo', 'tag']) if (!values[key]) fail('INVALID_ARGUMENT', `--${key} is required`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo)) fail('INVALID_ARGUMENT', '--repo is invalid');
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(values.tag)) fail('INVALID_ARGUMENT', '--tag is invalid');
  if (values['wait-for-present'] != null && values['wait-for-present'] !== 'true') {
    fail('INVALID_ARGUMENT', '--wait-for-present accepts only true');
  }
  return values;
}

function normalizeRelease(body, tag) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_RELEASE', 'GitHub returned an invalid release object');
  if (!Number.isSafeInteger(body.id) || body.id <= 0 || typeof body.draft !== 'boolean') {
    fail('INVALID_RELEASE', 'GitHub release has no valid immutable id or state');
  }
  if (body.tag_name !== tag) fail('RELEASE_TAG_MISMATCH', 'GitHub returned a release for a different tag');
  if (typeof body.body !== 'string' || Buffer.byteLength(body.body, 'utf8') > MAX_RELEASE_BODY_BYTES) {
    fail('INVALID_RELEASE', 'GitHub release body is invalid or unbounded');
  }
  return {
    id: body.id,
    draft: body.draft,
    body: body.body,
  };
}

export function interpretReleaseListPage({ status, body, tag }) {
  if (!Number.isSafeInteger(status) || status < 200 || status >= 300) {
    fail('GITHUB_API_FAILED', `GitHub release lookup returned ${status}`);
  }
  if (!Array.isArray(body) || body.length > RELEASES_PER_PAGE) {
    fail('INVALID_RELEASE_LIST', 'GitHub returned an invalid or unbounded release list');
  }
  const matches = body.filter((release) => release?.tag_name === tag);
  if (matches.length > 1) fail('DUPLICATE_RELEASE', 'GitHub returned multiple releases for the same tag');
  if (matches.length === 0) {
    return {
      status: 'NOT_FOUND_ON_PAGE',
      exhausted: body.length < RELEASES_PER_PAGE,
    };
  }
  return {
    status: 'PRESENT',
    tag,
    release: normalizeRelease(matches[0], tag),
  };
}

export async function inspectGitHubRelease({
  apiBase,
  repo,
  tag,
  token,
  fetchImpl = fetch,
  timeoutMs,
  waitForPresent = false,
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
  const normalizedApiBase = normalizeGitHubApiBase(apiBase);
  const retryBudget = budget ?? new RetryBudget({ timeoutMs: operationTimeoutMs, sleep });
  const visibilityAttempts = waitForPresent ? VISIBILITY_ATTEMPTS : 1;
  for (let visibilityAttempt = 1; visibilityAttempt <= visibilityAttempts; visibilityAttempt += 1) {
    let listExhausted = false;
    for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
      let response;
      try {
        const url = `${normalizedApiBase}/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`;
        response = await withGitHubReadRetry(async () => {
          const requestTimeoutMs = timeoutWithinRetryBudget(timeoutMs, retryBudget);
          const current = await fetchJsonWithDeadline(
            url,
            {
              headers: githubApiHeaders(token),
            },
            { fetchImpl, timeoutMs: requestTimeoutMs, includeErrorBody: true },
          );
          assertGitHubReadResponse(current, url);
          return current;
        }, { budget: retryBudget });
      } catch (error) {
        fail('GITHUB_API_FAILED', `GitHub release lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const result = interpretReleaseListPage({ status: response.status, body: response.body, tag });
      if (result.status === 'PRESENT') return result;
      if (result.exhausted) {
        listExhausted = true;
        break;
      }
    }
    if (!listExhausted) fail('RELEASE_LIST_LIMIT_EXCEEDED', 'Release lookup exceeded the bounded pagination limit');
    if (!waitForPresent) return { status: 'ABSENT', tag };
    if (visibilityAttempt < visibilityAttempts) {
      await retryBudget.wait(VISIBILITY_BASE_DELAY_MS * (2 ** (visibilityAttempt - 1)));
    }
  }
  fail('RELEASE_NOT_VISIBLE', 'Created release did not become visible within the bounded consistency window');
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const token = process.env.GH_TOKEN;
    if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required');
    const result = await inspectGitHubRelease({
      apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
      repo: args.repo,
      tag: args.tag,
      token,
      waitForPresent: args['wait-for-present'] === 'true',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof GitHubReleaseInspectionError ? error.code : 'RELEASE_INSPECTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
