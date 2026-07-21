const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 8_000;
// GitHub can signal primary or secondary rate limiting with 403/429.  A
// missing Retry-After header still requires a conservative pause; keep this
// separate from the short transient-error backoff so callers do not hammer
// the API while a quota window is closed.
export const DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS = 60_000;
export const DEFAULT_MAX_RATE_LIMIT_DELAY_MS = 60_000;
export const DEFAULT_RETRY_BUDGET_MS = 5 * 60_000;
const DEFAULT_RETRYABLE_STATUSES = Object.freeze(new Set([
  408, 425, 429,
  500, 502, 503, 504,
]));

export class GitHubReadError extends Error {
  constructor(url, status, message, retryAfterMs = undefined, metadata = undefined) {
    super(message);
    this.name = 'GitHubReadError';
    this.code = 'GITHUB_API_FAILED';
    this.url = url;
    this.status = status;
    const details = metadata ?? {};
    this.retryAfterMs = Number.isSafeInteger(retryAfterMs)
      ? retryAfterMs
      : details.retryAfterMs;
    this.rateLimited = details.rateLimited === true
      || status === 429
      || (status === 403 && (
        Number.isSafeInteger(this.retryAfterMs)
        || details.rateLimitRemaining === 0
      ));
    if (Number.isSafeInteger(details.rateLimitRemaining)) {
      this.rateLimitRemaining = details.rateLimitRemaining;
    }
    if (Number.isSafeInteger(details.rateLimitResetAtMs)) {
      this.rateLimitResetAtMs = details.rateLimitResetAtMs;
    }
    if (Number.isSafeInteger(details.rateLimitResetAfterMs)) {
      this.rateLimitResetAfterMs = details.rateLimitResetAfterMs;
    }
  }
}

export class GitHubRateLimitBoundError extends Error {
  constructor(cause, { maxDelayMs, hintedDelayMs }) {
    super(
      `GitHub rate-limit wait of ${hintedDelayMs}ms exceeds the ${maxDelayMs}ms retry budget`,
      { cause },
    );
    this.name = 'GitHubRateLimitBoundError';
    this.code = 'GITHUB_RATE_LIMIT_BUDGET_EXCEEDED';
    this.retryable = false;
    this.status = cause?.status;
    this.url = cause?.url;
    this.retryAfterMs = cause?.retryAfterMs;
    this.rateLimitResetAtMs = cause?.rateLimitResetAtMs;
    this.hintedDelayMs = hintedDelayMs;
    this.maxDelayMs = maxDelayMs;
  }
}

export class GitHubRetryDelayBoundError extends Error {
  constructor(cause, { maxDelayMs, hintedDelayMs }) {
    super(
      `GitHub Retry-After wait of ${hintedDelayMs}ms exceeds the ${maxDelayMs}ms retry budget`,
      { cause },
    );
    this.name = 'GitHubRetryDelayBoundError';
    this.code = 'GITHUB_RETRY_DELAY_BUDGET_EXCEEDED';
    this.retryable = false;
    this.status = cause?.status;
    this.url = cause?.url;
    this.retryAfterMs = cause?.retryAfterMs;
    this.hintedDelayMs = hintedDelayMs;
    this.maxDelayMs = maxDelayMs;
  }
}

export class GitHubRetryBudgetError extends Error {
  constructor(operation, remainingMs = 0) {
    super(`GitHub retry budget expired before ${operation} could complete`);
    this.name = 'GitHubRetryBudgetError';
    this.code = 'GITHUB_RETRY_BUDGET_EXCEEDED';
    this.operation = operation;
    this.remainingMs = remainingMs;
    this.retryable = false;
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
}

export class RetryBudget {
  constructor({ timeoutMs = undefined, deadlineAt = undefined, now = Date.now, sleep } = {}) {
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    if (timeoutMs !== undefined) positiveInteger(timeoutMs, 'timeoutMs');
    if (deadlineAt !== undefined) positiveInteger(deadlineAt, 'deadlineAt');
    if (timeoutMs !== undefined && deadlineAt !== undefined) {
      throw new TypeError('timeoutMs and deadlineAt are mutually exclusive');
    }
    if (sleep !== undefined && typeof sleep !== 'function') throw new TypeError('sleep must be a function');
    this.now = now;
    this.deadlineAt = deadlineAt ?? (timeoutMs === undefined ? undefined : now() + timeoutMs);
    if (this.deadlineAt !== undefined && !Number.isSafeInteger(this.deadlineAt)) {
      throw new TypeError('deadlineAt must be a safely representable timestamp');
    }
    this.sleepImpl = sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  }

  remainingMs() {
    if (this.deadlineAt === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.deadlineAt - this.now());
  }

  assertAvailable(operation = 'the next request') {
    const remainingMs = this.remainingMs();
    if (remainingMs <= 0) throw new GitHubRetryBudgetError(operation, remainingMs);
    return remainingMs;
  }

  async wait(delayMs, operation = 'the next retry') {
    positiveInteger(delayMs, 'delayMs');
    const remainingMs = this.assertAvailable(operation);
    if (delayMs > remainingMs) throw new GitHubRetryBudgetError(operation, remainingMs);
    await this.sleepImpl(delayMs);
    this.assertAvailable(operation);
  }
}

export function timeoutWithinRetryBudget(
  timeoutMs,
  budget,
  fallbackTimeoutMs = 30_000,
) {
  const configuredTimeoutMs = timeoutMs ?? fallbackTimeoutMs;
  positiveInteger(configuredTimeoutMs, 'timeoutMs');
  if (budget === undefined) return configuredTimeoutMs;
  if (!(budget instanceof RetryBudget)) throw new TypeError('budget must be a RetryBudget');
  const remainingMs = budget.assertAvailable('the next HTTP request');
  if (!Number.isFinite(remainingMs)) return configuredTimeoutMs;
  return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remainingMs)));
}

export function retryAfterMilliseconds(headers, now = Date.now()) {
  const value = headerValue(headers, 'retry-after');
  if (value == null || value === '') return undefined;
  const text = String(value).trim();
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) {
    const seconds = Number(text);
    const milliseconds = Math.ceil(seconds * 1_000);
    return Number.isSafeInteger(milliseconds) ? Math.max(0, milliseconds) : undefined;
  }
  const date = httpDateMilliseconds(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function httpDateMilliseconds(value) {
  const text = String(value ?? '').trim();
  // Only accept an RFC 7231 IMF-fixdate here. Date.parse is intentionally not
  // used as a general-purpose parser because values such as "+2" or "-1"
  // are interpreted as historical dates by some runtimes.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(text)) {
    return undefined;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key == null ? undefined : headers[key];
}

function nonNegativeIntegerHeader(headers, name) {
  const value = headerValue(headers, name);
  if (value == null || value === '') return undefined;
  const text = String(value).trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Extracts the provider's rate-limit signals once, so every mutation/read
 * adapter applies the same classification and delay policy.
 */
export function rateLimitMetadata(headers, status, now = Date.now(), body = undefined) {
  const serverDateMs = httpDateMilliseconds(headerValue(headers, 'date'));
  const referenceNow = serverDateMs ?? now;
  const retryAfterMs = retryAfterMilliseconds(headers, referenceNow);
  const rateLimitRemaining = nonNegativeIntegerHeader(headers, 'x-ratelimit-remaining');
  const resetSeconds = nonNegativeIntegerHeader(headers, 'x-ratelimit-reset');
  const rateLimitResetAtMs = resetSeconds == null || resetSeconds > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
    ? undefined
    : resetSeconds * 1_000;
  const rateLimitResetAfterMs = rateLimitResetAtMs == null
    ? undefined
    : Math.max(0, rateLimitResetAtMs - referenceNow);
  const message = typeof body?.message === 'string' ? body.message : '';
  const messageSignalsRateLimit = /(?:secondary\s+rate\s+limit|rate\s+limit|abuse\s+detection)/i.test(message);
  const rateLimited = status === 429
    || (status === 403 && (retryAfterMs !== undefined || rateLimitRemaining === 0 || messageSignalsRateLimit));
  return {
    rateLimited,
    retryAfterMs,
    rateLimitRemaining,
    rateLimitResetAtMs,
    rateLimitResetAfterMs,
  };
}

export function rateLimitHintMilliseconds(
  error,
  fallbackDelayMs = DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
) {
  positiveInteger(fallbackDelayMs, 'fallbackDelayMs');
  const hints = [];
  if (Number.isSafeInteger(error?.retryAfterMs)) hints.push(error.retryAfterMs);
  if (error?.rateLimitRemaining === 0 && Number.isSafeInteger(error?.rateLimitResetAfterMs)) {
    hints.push(error.rateLimitResetAfterMs);
  }
  return hints.length === 0 ? fallbackDelayMs : Math.max(...hints);
}

export function assertProviderDelayWithinBound(
  error,
  maxDelayMs = DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
  fallbackDelayMs = DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
) {
  positiveInteger(maxDelayMs, 'maxRateLimitDelayMs');
  const hintedDelayMs = rateLimitHintMilliseconds(error, fallbackDelayMs);
  if (error?.rateLimited && hintedDelayMs > maxDelayMs) {
    throw new GitHubRateLimitBoundError(error, { maxDelayMs, hintedDelayMs });
  }
  if (!error?.rateLimited && Number.isSafeInteger(error?.retryAfterMs)
    && error.retryAfterMs > maxDelayMs) {
    throw new GitHubRetryDelayBoundError(error, {
      maxDelayMs,
      hintedDelayMs: error.retryAfterMs,
    });
  }
  return hintedDelayMs;
}

export function calculateGitHubRetryDelay(
  error,
  {
    attempt,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxRateLimitDelayMs = DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
    rateLimitFallbackDelayMs = DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
  } = {},
) {
  positiveInteger(attempt, 'attempt');
  positiveInteger(baseDelayMs, 'baseDelayMs');
  positiveInteger(maxDelayMs, 'maxDelayMs');
  if (maxRateLimitDelayMs < baseDelayMs) {
    throw new TypeError('maxRateLimitDelayMs must be greater than or equal to baseDelayMs');
  }
  positiveInteger(maxRateLimitDelayMs, 'maxRateLimitDelayMs');
  positiveInteger(rateLimitFallbackDelayMs, 'rateLimitFallbackDelayMs');
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(attempt - 1, 30)));
  if (!error?.rateLimited) {
    const retryAfterMs = Number.isSafeInteger(error?.retryAfterMs) ? error.retryAfterMs : 0;
    return Math.min(maxRateLimitDelayMs, Math.max(exponential, retryAfterMs));
  }
  const hinted = rateLimitHintMilliseconds(error, rateLimitFallbackDelayMs);
  return Math.min(maxRateLimitDelayMs, Math.max(exponential, hinted));
}

export function shouldRetryGitHubRead(error, retryableStatuses = DEFAULT_RETRYABLE_STATUSES) {
  if (error?.code === 'FETCH_TIMEOUT' || error?.code === 'FETCH_TRANSPORT_ERROR') return true;
  if (error?.rateLimited === true) return true;
  return Number.isSafeInteger(error?.status) && retryableStatuses.has(error.status);
}

export async function withGitHubReadRetry(
  operation,
  {
    attempts = DEFAULT_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxRateLimitDelayMs = DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
    rateLimitFallbackDelayMs = DEFAULT_RATE_LIMIT_FALLBACK_DELAY_MS,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
    retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
    budget = undefined,
    deadlineAt = undefined,
    now = Date.now,
  } = {},
) {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function');
  positiveInteger(attempts, 'attempts');
  positiveInteger(baseDelayMs, 'baseDelayMs');
  positiveInteger(maxDelayMs, 'maxDelayMs');
  positiveInteger(maxRateLimitDelayMs, 'maxRateLimitDelayMs');
  positiveInteger(rateLimitFallbackDelayMs, 'rateLimitFallbackDelayMs');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
  if (budget !== undefined && !(budget instanceof RetryBudget)) {
    throw new TypeError('budget must be a RetryBudget');
  }
  if (budget !== undefined && deadlineAt !== undefined) {
    throw new TypeError('budget and deadlineAt are mutually exclusive');
  }
  const retryBudget = budget ?? (deadlineAt === undefined
    ? undefined
    : new RetryBudget({ deadlineAt, now, sleep }));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      retryBudget?.assertAvailable('the next GitHub request');
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetryGitHubRead(error, retryableStatuses)) throw error;
      assertProviderDelayWithinBound(error, maxRateLimitDelayMs, rateLimitFallbackDelayMs);
      const delayMs = calculateGitHubRetryDelay(error, {
        attempt,
        baseDelayMs,
        maxDelayMs,
        maxRateLimitDelayMs,
        rateLimitFallbackDelayMs,
      });
      if (retryBudget) await retryBudget.wait(delayMs);
      else await sleep(delayMs);
    }
  }
  throw lastError;
}

export function assertGitHubReadResponse(response, url) {
  if (!response?.ok) {
    const metadata = rateLimitMetadata(response?.headers, response?.status, Date.now(), response?.body);
    throw new GitHubReadError(
      url,
      response?.status,
      `GitHub API returned ${response?.status ?? 'an invalid status'}`,
      metadata.retryAfterMs,
      metadata,
    );
  }
  return response.body;
}
