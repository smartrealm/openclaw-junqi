#!/usr/bin/env node

import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
const FULL_SHA = /^[0-9a-f]{40}$/;
const VERSION_TAG = /^v[0-9A-Za-z][0-9A-Za-z._-]*$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_ANNOTATED_TAG_DEPTH = 4;

export class GitHubTagTargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubTagTargetError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GitHubTagTargetError(code, message);
}

function sha(value, field) {
  if (typeof value !== 'string' || !FULL_SHA.test(value)) {
    fail('INVALID_TAG_RESPONSE', `${field} must be a full lowercase commit SHA`);
  }
  return value;
}

function sameSha(left, right) {
  if (!FULL_SHA.test(left) || !FULL_SHA.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function objectTarget(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TAG_RESPONSE', `${field} must be an object`);
  }
  const type = value.type;
  if (type !== 'commit' && type !== 'tag') {
    fail('INVALID_TAG_RESPONSE', `${field}.type must be commit or tag`);
  }
  return { type, sha: sha(value.sha, `${field}.sha`) };
}

/**
 * Pure tag/ref policy. The API adapter supplies the ref and any annotated tag
 * objects; this function decides whether the final object is the expected
 * source commit without trusting tag names or mutable ref metadata.
 */
export function validateTagTarget({ tag, expectedSha, refResponse, tagObjectsBySha = {} }) {
  if (typeof tag !== 'string' || !VERSION_TAG.test(tag)) fail('INVALID_TAG', 'tag must be a version tag');
  const sourceSha = sha(expectedSha, 'expectedSha');
  const expectedRef = `refs/tags/${tag}`;
  if (!refResponse || refResponse.ref !== expectedRef) {
    fail('TAG_REF_MISMATCH', 'GitHub returned a different tag ref');
  }

  let target = objectTarget(refResponse.object, 'tag ref object');
  const visited = new Set();
  for (let depth = 0; target.type === 'tag'; depth += 1) {
    if (depth >= MAX_ANNOTATED_TAG_DEPTH) {
      fail('TAG_DEREFERENCE_LIMIT', 'Annotated tag chain exceeds the supported depth');
    }
    if (visited.has(target.sha)) fail('TAG_CYCLE', 'Annotated tag chain contains a cycle');
    visited.add(target.sha);
    const annotated = tagObjectsBySha[target.sha];
    if (!annotated) fail('TAG_OBJECT_MISSING', `Annotated tag object ${target.sha} was not provided`);
    target = objectTarget(annotated.object, `annotated tag ${target.sha}`);
  }

  if (!sameSha(target.sha, sourceSha)) {
    fail('TAG_TARGET_MISMATCH', 'Version tag does not point to the immutable release source SHA');
  }
  return Object.freeze({ tag, ref: expectedRef, targetSha: target.sha });
}

function parseArgs(argv) {
  if (argv.length !== 6) fail('INVALID_ARGUMENT', 'Usage: --repo <owner/name> --tag <vX> --expected-sha <sha>');
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) fail('INVALID_ARGUMENT', `Invalid argument near ${flag ?? '<end>'}`);
    const key = flag.slice(2);
    if (!['repo', 'tag', 'expected-sha'].includes(key) || Object.hasOwn(values, key)) {
      fail('INVALID_ARGUMENT', `Unexpected argument ${flag}`);
    }
    values[key] = value;
  }
  if (!REPOSITORY.test(values.repo)) fail('INVALID_ARGUMENT', '--repo is invalid');
  if (!VERSION_TAG.test(values.tag)) fail('INVALID_ARGUMENT', '--tag is invalid');
  sha(values['expected-sha'], '--expected-sha');
  return values;
}

async function apiJson(url, token, { budget, fetchImpl = fetch, timeoutMs } = {}) {
  return withGitHubReadRetry(async () => {
    const requestTimeoutMs = timeoutWithinRetryBudget(timeoutMs, budget);
    const response = await fetchJsonWithDeadline(url, {
      headers: githubApiHeaders(token),
    }, {
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      includeErrorBody: true,
    });
    return assertGitHubReadResponse(response, url);
  }, { budget });
}

async function resolveRemoteTag({
  apiBase,
  repo,
  tag,
  expectedSha,
  token,
  fetchImpl = fetch,
  timeoutMs,
  operationTimeoutMs = DEFAULT_RETRY_BUDGET_MS,
  budget = undefined,
}) {
  const retryBudget = budget ?? new RetryBudget({ timeoutMs: operationTimeoutMs });
  const apiOptions = { budget: retryBudget, fetchImpl, timeoutMs };
  const refResponse = await apiJson(
    `${apiBase}/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
    token,
    apiOptions,
  );
  const tagObjectsBySha = {};
  let target = refResponse?.object;
  for (let depth = 0; target?.type === 'tag'; depth += 1) {
    if (depth >= MAX_ANNOTATED_TAG_DEPTH) {
      fail('TAG_DEREFERENCE_LIMIT', 'Annotated tag chain exceeds the supported depth');
    }
    const targetSha = sha(target.sha, `tag ref object at depth ${depth}`);
    if (Object.hasOwn(tagObjectsBySha, targetSha)) fail('TAG_CYCLE', 'Annotated tag chain contains a cycle');
    const annotated = await apiJson(
      `${apiBase}/repos/${repo}/git/tags/${targetSha}`,
      token,
      apiOptions,
    );
    tagObjectsBySha[targetSha] = annotated;
    target = annotated?.object;
  }
  return validateTagTarget({ tag, expectedSha, refResponse, tagObjectsBySha });
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const token = process.env.GH_TOKEN;
    if (!token) fail('GITHUB_TOKEN_MISSING', 'GH_TOKEN is required');
    const apiBase = normalizeGitHubApiBase(process.env.GITHUB_API_URL || 'https://api.github.com');
    const result = await resolveRemoteTag({
      apiBase,
      repo: args.repo,
      tag: args.tag,
      expectedSha: args['expected-sha'],
      token,
    });
    process.stdout.write(`${JSON.stringify({ status: 'VERIFIED', ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof GitHubTagTargetError ? error.code : 'TAG_VERIFICATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main();
