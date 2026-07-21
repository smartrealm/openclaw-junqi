const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ERROR_BODY_BYTES = 8 * 1024;

export class FetchDeadlineError extends Error {
  constructor(url, timeoutMs) {
    super(`HTTP request exceeded the ${timeoutMs}ms deadline: ${url}`);
    this.name = 'FetchDeadlineError';
    this.code = 'FETCH_TIMEOUT';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class FetchResponseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FetchResponseError';
    this.code = code;
  }
}

export class FetchTransportError extends Error {
  constructor(url, cause) {
    super(`HTTP transport failed before a complete response was consumed: ${url}`, { cause });
    this.name = 'FetchTransportError';
    this.code = 'FETCH_TRANSPORT_ERROR';
    this.url = url;
  }
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function contentLength(response) {
  const value = response?.headers?.get?.('content-length');
  if (value == null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new FetchResponseError('INVALID_CONTENT_LENGTH', 'HTTP response has an invalid Content-Length header');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new FetchResponseError('INVALID_CONTENT_LENGTH', 'HTTP response Content-Length is not safely representable');
  }
  return parsed;
}

async function readBoundedBody(response, maxBytes, signal) {
  const declaredBytes = contentLength(response);
  const contentEncoding = response?.headers?.get?.('content-encoding')?.trim().toLowerCase();
  // Undici exposes the decoded body while retaining the wire Content-Length
  // header for compressed responses. Only identity-encoded bodies can use an
  // equality check; every response is still bounded by decoded bytes below.
  const identityEncoded = !contentEncoding || contentEncoding === 'identity';
  if (identityEncoded && declaredBytes != null && declaredBytes > maxBytes) {
    throw new FetchResponseError(
      'RESPONSE_TOO_LARGE',
      `HTTP response declares ${declaredBytes} bytes, exceeding the ${maxBytes}-byte limit`,
    );
  }
  if (response?.body == null) return '';
  if (typeof response.body.getReader !== 'function') {
    throw new FetchResponseError('INVALID_RESPONSE_BODY', 'HTTP response body is not a readable web stream');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  const abortReader = () => {
    reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', abortReader, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new FetchResponseError('INVALID_RESPONSE_BODY', 'HTTP response emitted a non-binary body chunk');
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('response byte limit exceeded').catch(() => undefined);
        throw new FetchResponseError(
          'RESPONSE_TOO_LARGE',
          `HTTP response exceeds the ${maxBytes}-byte limit`,
        );
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    signal.removeEventListener('abort', abortReader);
    reader.releaseLock();
  }

  if (identityEncoded && declaredBytes != null && declaredBytes !== totalBytes) {
    throw new FetchResponseError(
      'CONTENT_LENGTH_MISMATCH',
      `HTTP response declared ${declaredBytes} bytes but delivered ${totalBytes}`,
    );
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

async function readOptionalErrorBody(response, maxBytes, signal) {
  try {
    const text = await readBoundedBody(response, maxBytes, signal);
    return JSON.parse(text);
  } catch {
    if (response?.body && typeof response.body.cancel === 'function') {
      await response.body.cancel('error body ignored').catch(() => undefined);
    }
    return undefined;
  }
}

async function requestWithDeadline(
  url,
  options,
  { fetchImpl, timeoutMs, consume },
) {
  positiveSafeInteger(timeoutMs, 'timeoutMs');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof consume !== 'function') throw new TypeError('consume must be a function');

  const controller = new AbortController();
  const externalSignal = options.signal;
  let rejectExternalAbort;
  const externalAbort = new Promise((_, reject) => {
    rejectExternalAbort = reject;
  });
  const forwardExternalAbort = () => {
    const reason = externalSignal.reason instanceof Error
      ? externalSignal.reason
      : new DOMException('The operation was aborted', 'AbortError');
    controller.abort(reason);
    rejectExternalAbort(reason);
  };
  if (externalSignal?.aborted) forwardExternalAbort();
  else externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true });

  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new FetchDeadlineError(url, timeoutMs);
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  const request = Promise.resolve().then(async () => {
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      return await consume(response, controller.signal);
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof Error) {
        throw controller.signal.reason;
      }
      if (error instanceof FetchDeadlineError
        || error instanceof FetchResponseError
        || error instanceof FetchTransportError) {
        throw error;
      }
      throw new FetchTransportError(url, error);
    }
  });
  request.catch(() => undefined);
  deadline.catch(() => undefined);
  externalAbort.catch(() => undefined);
  try {
    const contenders = externalSignal
      ? [request, deadline, externalAbort]
      : [request, deadline];
    return await Promise.race(contenders);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardExternalAbort);
  }
}

export async function fetchJsonWithDeadline(
  url,
  options = {},
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
    includeErrorBody = false,
    maxErrorBytes = DEFAULT_MAX_ERROR_BODY_BYTES,
  } = {},
) {
  positiveSafeInteger(maxBytes, 'maxBytes');
  if (includeErrorBody !== true && includeErrorBody !== false) {
    throw new TypeError('includeErrorBody must be a boolean');
  }
  positiveSafeInteger(maxErrorBytes, 'maxErrorBytes');
  return requestWithDeadline(url, options, {
    fetchImpl,
    timeoutMs,
    consume: async (response, signal) => {
      if (!response || !Number.isSafeInteger(response.status) || typeof response.ok !== 'boolean') {
        throw new FetchResponseError('INVALID_RESPONSE', 'HTTP adapter returned an invalid response');
      }
      if (!response.ok) {
        const body = includeErrorBody && (response.status === 403 || response.status === 429)
          ? await readOptionalErrorBody(response, maxErrorBytes, signal)
          : undefined;
        if (body === undefined && response.body && typeof response.body.cancel === 'function') {
          await response.body.cancel().catch(() => undefined);
        }
        return {
          status: response.status,
          ok: false,
          headers: response.headers,
          body,
        };
      }
      const text = await readBoundedBody(response, maxBytes, signal);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new FetchResponseError('INVALID_JSON', 'HTTP response did not contain valid JSON');
      }
      return { status: response.status, ok: response.ok, headers: response.headers, body };
    },
  });
}

export async function fetchStatusWithDeadline(
  url,
  options = {},
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    includeErrorBody = false,
    maxErrorBytes = DEFAULT_MAX_ERROR_BODY_BYTES,
  } = {},
) {
  if (includeErrorBody !== true && includeErrorBody !== false) {
    throw new TypeError('includeErrorBody must be a boolean');
  }
  positiveSafeInteger(maxErrorBytes, 'maxErrorBytes');
  return requestWithDeadline(url, options, {
    fetchImpl,
    timeoutMs,
    consume: async (response, signal) => {
      if (!response || !Number.isSafeInteger(response.status) || typeof response.ok !== 'boolean') {
        throw new FetchResponseError('INVALID_RESPONSE', 'HTTP adapter returned an invalid response');
      }
      const body = includeErrorBody && !response.ok && (response.status === 403 || response.status === 429)
        ? await readOptionalErrorBody(response, maxErrorBytes, signal)
        : undefined;
      if (body === undefined && response.body && typeof response.body.cancel === 'function') {
        await response.body.cancel().catch(() => undefined);
      }
      // Preserve response headers/body for callers that need provider retry
      // metadata (for example GitHub's rate-limit and Retry-After signals).
      return { status: response.status, ok: response.ok, headers: response.headers, body };
    },
  });
}
