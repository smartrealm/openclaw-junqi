#!/usr/bin/env node

import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROVIDER_MODEL_ID = 'deterministic';
export const PROVIDER_PORT = 44_080;
export const PROVIDER_MAX_BODY_BYTES = 2 * 1024 * 1024;

const PROMPT_MARKERS = Object.freeze([
  ['planner', 'You are the planner for a durable multi-agent collaboration.'],
  ['worker', 'You are a worker in a JunQi collaboration run.'],
  ['synthesizer', 'You are the synthesizer for a durable multi-agent collaboration.'],
]);

const json = (value) => JSON.stringify(value);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectText(value, output) {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of ['text', 'content', 'input']) {
    if (key in value) collectText(value[key], output);
  }
}

export function requestPrompt(body) {
  const parts = [];
  collectText(body?.input, parts);
  if (typeof body?.instructions === 'string') parts.unshift(body.instructions);
  return parts.join('\n');
}

export function classifyPrompt(prompt) {
  for (const [kind, marker] of PROMPT_MARKERS) {
    if (prompt.includes(marker)) return kind;
  }
  return 'origin';
}

function markerJson(prompt, marker) {
  const start = prompt.indexOf(marker);
  if (start < 0) return null;
  const rest = prompt.slice(start + marker.length).trimStart();
  const line = rest.split(/\r?\n/, 1)[0]?.trim();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function firstAllowedWorker(prompt) {
  const agents = markerJson(prompt, 'AVAILABLE_AGENTS=');
  if (!Array.isArray(agents)) return 'worker';
  const allowed = agents.filter((agent) => isRecord(agent) && agent.allowed !== false);
  const worker = allowed.find((agent) => agent.id !== 'coordinator') ?? allowed[0];
  return typeof worker?.id === 'string' && worker.id ? worker.id : 'worker';
}

function markerValue(prompt, marker, fallback) {
  const start = prompt.indexOf(marker);
  if (start < 0) return fallback;
  const value = prompt.slice(start + marker.length).split(/\r?\n/, 1)[0]?.trim();
  return value || fallback;
}

export function buildDeterministicText(kind, prompt) {
  if (kind === 'planner') {
    const goal = markerValue(prompt, 'GOAL=', 'Complete the deterministic collaboration check');
    const workerId = firstAllowedWorker(prompt);
    return json({
      goal,
      workItems: [{
        id: 'deterministic-check',
        title: 'Produce verifiable deterministic evidence',
        inputScope: ['The supplied collaboration goal'],
        dependencies: [],
        requiredCapabilities: ['text-analysis'],
        candidateAgentIds: [workerId],
        acceptanceCriteria: ['Return the deterministic evidence marker'],
        riskLevel: 'LOW',
        sideEffectClass: 'READ_ONLY',
      }],
      synthesis: {
        requiredEvidence: ['JUNQI_DETERMINISTIC_WORKER_OK'],
        finalAnswerContract: 'Return a concise answer containing JUNQI_DETERMINISTIC_SYNTHESIS_OK.',
      },
    });
  }
  if (kind === 'worker') {
    return json({
      summary: 'JUNQI_DETERMINISTIC_WORKER_OK',
      outcome: 'SUCCEEDED',
      evidence: [{
        type: 'deterministic-provider',
        title: 'Deterministic worker execution',
        reference: 'junqi://behavioral-harness/worker',
        verification: 'JUNQI_DETERMINISTIC_WORKER_OK',
      }],
      createdArtifacts: [],
      handoffNotes: [],
    });
  }
  if (kind === 'synthesizer') return 'JUNQI_DETERMINISTIC_SYNTHESIS_OK';
  return 'JUNQI_DETERMINISTIC_ORIGIN_ACK';
}

function usageFor(prompt, text) {
  const inputTokens = Math.max(1, Math.ceil(Buffer.byteLength(prompt, 'utf8') / 4));
  const outputTokens = Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: inputTokens + outputTokens,
  };
}

export function buildResponse(body, text, sequence = 1, now = Date.now()) {
  const model = typeof body?.model === 'string' && body.model ? body.model : PROVIDER_MODEL_ID;
  const idSuffix = String(sequence).padStart(8, '0');
  const responseId = `resp_junqi_${idSuffix}`;
  const itemId = `msg_junqi_${idSuffix}`;
  const output = [{
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
  }];
  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(now / 1000),
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: 0,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    truncation: 'disabled',
    usage: usageFor(requestPrompt(body), text),
  };
}

export function buildResponseEvents(response) {
  const item = response.output[0];
  const part = item.content[0];
  const pendingResponse = { ...response, status: 'in_progress', output: [], usage: null };
  let sequenceNumber = 0;
  const event = (type, fields) => ({ type, sequence_number: sequenceNumber++, ...fields });
  return [
    event('response.created', { response: pendingResponse }),
    event('response.in_progress', { response: pendingResponse }),
    event('response.output_item.added', {
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    }),
    event('response.content_part.added', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { ...part, text: '' },
    }),
    event('response.output_text.delta', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: part.text,
      logprobs: [],
    }),
    event('response.output_text.done', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: part.text,
      logprobs: [],
    }),
    event('response.content_part.done', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part,
    }),
    event('response.output_item.done', { output_index: 0, item }),
    event('response.completed', { response }),
  ];
}

export function encodeResponseSse(response) {
  return `${buildResponseEvents(response)
    .map((event) => `event: ${event.type}\ndata: ${json(event)}\n\n`)
    .join('')}data: [DONE]\n\n`;
}

export class ProviderAuditLog {
  #active = 0;
  #maxConcurrent = 0;
  #requests = [];
  #sequence = 0;

  begin(kind, bodyBytes) {
    const sequence = ++this.#sequence;
    this.#active += 1;
    this.#maxConcurrent = Math.max(this.#maxConcurrent, this.#active);
    const record = {
      sequence,
      kind,
      model: PROVIDER_MODEL_ID,
      bodySha256: sha256(bodyBytes),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      outcome: 'running',
    };
    this.#requests.push(record);
    return {
      sequence,
      finish: (outcome) => {
        if (record.finishedAt !== null) return;
        record.finishedAt = new Date().toISOString();
        record.outcome = outcome;
        this.#active = Math.max(0, this.#active - 1);
      },
    };
  }

  snapshot(holdKinds = []) {
    const counts = {};
    for (const record of this.#requests) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
    return {
      model: PROVIDER_MODEL_ID,
      active: this.#active,
      maxConcurrent: this.#maxConcurrent,
      holdKinds: [...holdKinds].sort(),
      counts,
      requests: this.#requests.map((record) => ({ ...record })),
    };
  }
}

class HoldController {
  #heldKinds = new Set();
  #waiters = new Set();

  setKinds(kinds) {
    this.#heldKinds = new Set(kinds);
    for (const notify of this.#waiters) notify();
  }

  kinds() {
    return [...this.#heldKinds];
  }

  async wait(kind, signal) {
    while (this.#heldKinds.has(kind)) {
      await new Promise((resolve, reject) => {
        const onAbort = () => finish(new Error('request aborted'));
        const onChange = () => finish();
        const finish = (error) => {
          signal.removeEventListener('abort', onAbort);
          this.#waiters.delete(onChange);
          if (error) reject(error);
          else resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.#waiters.add(onChange);
        if (signal.aborted) onAbort();
      });
    }
  }
}

function sendJson(response, status, value) {
  const bytes = Buffer.from(json(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.byteLength),
    'cache-control': 'no-store',
  });
  response.end(bytes);
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.byteLength;
    if (received > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`);
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength === 0) return { bytes, value: {} };
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    const error = new Error('request body is not valid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function validatedHoldKinds(value) {
  if (!isRecord(value) || !Array.isArray(value.holdKinds)) throw new Error('holdKinds must be an array');
  const allowed = new Set(['origin', 'planner', 'worker', 'synthesizer']);
  const kinds = [...new Set(value.holdKinds)];
  if (kinds.some((kind) => typeof kind !== 'string' || !allowed.has(kind))) {
    throw new Error('holdKinds contains an unsupported request kind');
  }
  return kinds;
}

export function createProviderServer(options = {}) {
  const audit = options.audit ?? new ProviderAuditLog();
  const holds = options.holds ?? new HoldController();
  const maxBodyBytes = options.maxBodyBytes ?? PROVIDER_MAX_BODY_BYTES;
  const server = http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    try {
      const url = new URL(request.url ?? '/', 'http://provider.invalid');
      if (request.method === 'GET' && ['/healthz', '/readyz'].includes(url.pathname)) {
        sendJson(response, 200, { ok: true, status: 'live' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(response, 200, { object: 'list', data: [{ id: PROVIDER_MODEL_ID, object: 'model' }] });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/debug/state') {
        sendJson(response, 200, audit.snapshot(holds.kinds()));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/debug/control') {
        const body = await readBody(request, maxBodyBytes);
        holds.setKinds(validatedHoldKinds(body.value));
        sendJson(response, 200, { ok: true, holdKinds: holds.kinds().sort() });
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/responses') {
        sendJson(response, 404, { error: { type: 'not_found', message: 'route not found' } });
        return;
      }

      const body = await readBody(request, maxBodyBytes);
      if (!isRecord(body.value)) throw new Error('request body must be an object');
      const prompt = requestPrompt(body.value);
      const kind = classifyPrompt(prompt);
      const entry = audit.begin(kind, body.bytes);
      const abort = new AbortController();
      const abortRequest = () => abort.abort();
      request.once('aborted', abortRequest);
      response.once('close', abortRequest);
      try {
        await holds.wait(kind, abort.signal);
        if (abort.signal.aborted) throw new Error('request aborted');
        const text = buildDeterministicText(kind, prompt);
        const providerResponse = buildResponse(body.value, text, entry.sequence);
        if (body.value.stream === false) {
          sendJson(response, 200, providerResponse);
        } else {
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-store',
            connection: 'keep-alive',
          });
          response.end(encodeResponseSse(providerResponse));
        }
        entry.finish('completed');
      } catch (error) {
        entry.finish(abort.signal.aborted ? 'aborted' : 'failed');
        if (!response.headersSent && !response.destroyed) {
          sendJson(response, abort.signal.aborted ? 499 : 500, {
            error: { type: 'provider_error', message: abort.signal.aborted ? 'request aborted' : 'request failed' },
          });
        }
      } finally {
        request.removeListener('aborted', abortRequest);
        response.removeListener('close', abortRequest);
      }
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(response, status, { error: { type: 'invalid_request_error', message: error.message } });
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return { server, audit, holds };
}

export async function startProvider(options = {}) {
  const port = options.port ?? PROVIDER_PORT;
  const host = options.host ?? '0.0.0.0';
  const provider = createProviderServer(options);
  await new Promise((resolve, reject) => {
    provider.server.once('error', reject);
    provider.server.listen(port, host, () => {
      provider.server.removeListener('error', reject);
      resolve();
    });
  });
  process.stdout.write(`${json({ event: 'provider.ready', host, port, model: PROVIDER_MODEL_ID })}\n`);
  return provider;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const { server } = await startProvider();
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
