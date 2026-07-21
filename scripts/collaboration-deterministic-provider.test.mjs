import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, test } from 'node:test';

import {
  ProviderAuditLog,
  buildDeterministicText,
  buildResponse,
  buildResponseEvents,
  classifyPrompt,
  createProviderServer,
  requestPrompt,
} from './collaboration-deterministic-provider.mjs';

describe('deterministic collaboration provider', () => {
  test('classifies only the reviewed JunQi prompt contracts', () => {
    assert.equal(classifyPrompt('You are the planner for a durable multi-agent collaboration.'), 'planner');
    assert.equal(classifyPrompt('You are a worker in a JunQi collaboration run.'), 'worker');
    assert.equal(classifyPrompt('You are the synthesizer for a durable multi-agent collaboration.'), 'synthesizer');
    assert.equal(classifyPrompt('ordinary user input'), 'origin');
    assert.equal(requestPrompt({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] }), 'hello');
  });

  test('returns valid planner and worker contracts using an allowed runtime agent', () => {
    const planner = JSON.parse(buildDeterministicText(
      'planner',
      'AVAILABLE_AGENTS=[{"id":"coordinator","allowed":true},{"id":"reviewer","allowed":true}]\nGOAL=Review a report',
    ));
    assert.equal(planner.goal, 'Review a report');
    assert.deepEqual(planner.workItems[0].candidateAgentIds, ['reviewer']);
    assert.equal(planner.workItems[0].sideEffectClass, 'READ_ONLY');

    const worker = JSON.parse(buildDeterministicText('worker', ''));
    assert.equal(worker.outcome, 'SUCCEEDED');
    assert.equal(worker.evidence[0].verification, 'JUNQI_DETERMINISTIC_WORKER_OK');
    assert.equal(buildDeterministicText('synthesizer', ''), 'JUNQI_DETERMINISTIC_SYNTHESIS_OK');
  });

  test('emits a complete OpenAI Responses event lifecycle', () => {
    const response = buildResponse({ model: 'deterministic', input: 'hello' }, 'done', 7, 1_700_000_000_000);
    const events = buildResponseEvents(response);
    assert.deepEqual(events.map((event) => event.type), [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    assert.equal(events.at(-1).response.output[0].content[0].text, 'done');
    assert.deepEqual(events.map((event) => event.sequence_number), [...events.keys()]);
  });

  test('audit snapshots retain metadata and hashes but no request content', () => {
    const audit = new ProviderAuditLog();
    const entry = audit.begin('planner', Buffer.from('TOP SECRET PROMPT'));
    entry.finish('completed');
    const serialized = JSON.stringify(audit.snapshot());
    assert.equal(serialized.includes('TOP SECRET PROMPT'), false);
    assert.match(audit.snapshot().requests[0].bodySha256, /^[a-f0-9]{64}$/);
    assert.equal(audit.snapshot().counts.planner, 1);
  });

  test('serves non-streaming responses and never exposes prompts in debug state', async () => {
    const { server } = createProviderServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'deterministic', stream: false, input: 'PRIVATE ORIGIN MESSAGE' }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.output[0].content[0].text, 'JUNQI_DETERMINISTIC_ORIGIN_ACK');
      const state = await (await fetch(`http://127.0.0.1:${address.port}/debug/state`)).json();
      assert.equal(JSON.stringify(state).includes('PRIVATE ORIGIN MESSAGE'), false);
      assert.equal(state.counts.origin, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
