import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawAuditClient,
  OpenClawAuditResponseError,
  OpenClawAuditUnsupportedError,
  parseOpenClawAuditActivityPage,
} from './OpenClawAuditClient';

const activityEvent = {
  eventType: 'tool_action',
  schemaVersion: 1,
  eventId: 'activity-event-1',
  sequence: 2,
  sourceSequence: 3,
  occurredAt: 1_700_000_000_100,
  kind: 'tool_action',
  action: 'tool.action.finished',
  status: 'cancelled',
  errorCode: 'tool_cancelled',
  actor: { type: 'agent', id: 'main' },
  agentId: 'main',
  sessionKey: 'agent:main:desktop',
  sessionId: 'session-1',
  runId: 'run-1',
  toolCallId: 'call-1',
  toolName: 'exec',
  redaction: 'metadata_only',
};

describe('OpenClawAuditClient', () => {
  it('queries only the versioned activity ledger', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawAuditClient(
      async <T>(method: string, params: Record<string, unknown>) => {
        requests.push({ method, params });
        return { events: [activityEvent] } as T;
      },
    );

    const page = await client.list({ runId: 'run-1', kind: 'tool_action', limit: 10 });
    assert.equal(requests[0]?.method, 'audit.activity.list');
    assert.deepEqual(requests[0]?.params, { runId: 'run-1', kind: 'tool_action', limit: 10 });
    assert.equal(page.source, 'activity');
    assert.equal(page.events[0]?.toolName, 'exec');
    assert.equal(page.events[0]?.errorCode, 'tool_cancelled');
  });

  it('reports unavailable without querying another audit protocol', async () => {
    const methods: string[] = [];
    const client = new OpenClawAuditClient(async (method) => {
      methods.push(method);
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });

    await assert.rejects(
      client.list({ runId: 'run-1' }),
      (error: unknown) => error instanceof OpenClawAuditUnsupportedError,
    );
    assert.deepEqual(methods, ['audit.activity.list']);
  });

  it('enforces activity terminal error-code correlations', () => {
    assert.throws(
      () => parseOpenClawAuditActivityPage({
        events: [{
          ...activityEvent,
          status: 'failed',
          errorCode: 'tool_cancelled',
        }],
      }),
      (error: unknown) => error instanceof OpenClawAuditResponseError,
    );
  });

  it('keeps metadata-only activity fields and drops no contract boundary into raw payloads', () => {
    const page = parseOpenClawAuditActivityPage({ events: [{ ...activityEvent, prompt: 'must-not-be-consumed' }] });
    assert.equal('prompt' in page.events[0]!, false);
    assert.equal(page.events[0]?.redaction, 'metadata_only');
  });

  it('accepts the official active-run injection completion reason', () => {
    const page = parseOpenClawAuditActivityPage({
      events: [{
        eventType: 'inbound_message',
        schemaVersion: 1,
        eventId: 'inbound-event-1',
        sequence: 4,
        sourceSequence: 5,
        occurredAt: 1_700_000_000_200,
        kind: 'message',
        action: 'message.inbound.processed',
        status: 'succeeded',
        actor: { type: 'system', id: 'gateway' },
        redaction: 'metadata_only',
        direction: 'inbound',
        channel: 'webchat',
        conversationKind: 'direct',
        outcome: 'completed',
        reasonCode: 'active_run_injected',
      }],
    });
    assert.equal(page.events[0]?.reasonCode, 'active_run_injected');
  });
});
