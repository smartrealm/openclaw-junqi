import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessActivityAttempt } from '@/business-applications/activityStore';
import type { OpenClawAuditEvent } from '@/services/gateway/OpenClawAuditClient';
import { summarizeDingTalkBusinessActivity } from './businessActivitySummary';

function event(overrides: Partial<OpenClawAuditEvent>): OpenClawAuditEvent {
  return {
    source: 'activity',
    eventType: 'tool_action',
    schemaVersion: 1,
    eventId: 'event-1',
    sequence: 1,
    sourceSequence: 1,
    occurredAt: 1,
    kind: 'tool_action',
    action: 'tool.action.finished',
    status: 'succeeded',
    actor: { type: 'agent', id: 'main' },
    redaction: 'metadata_only',
    ...overrides,
  };
}

function attempt(overrides: Partial<BusinessActivityAttempt>): BusinessActivityAttempt {
  return {
    id: 'attempt-1',
    sessionKey: 'agent:main:main',
    sessionId: 'session-1',
    agentId: 'main',
    runtimeFingerprint: null,
    runtimeConnectionId: null,
    toolName: 'junqi_dingtalk_contact_get',
    toolLabel: '读取联系人',
    profileRef: null,
    effect: 'read',
    risk: 'low',
    state: 'succeeded',
    startedAt: 1,
    ...overrides,
  };
}

test('审计摘要按官方记录和本窗口投影派生参与 Agent 与状态', () => {
  const summary = summarizeDingTalkBusinessActivity([
    event({ eventId: 'event-running', status: 'started', action: 'tool.action.started', agentId: 'main' }),
    event({ eventId: 'event-failed', sequence: 2, sourceSequence: 2, status: 'failed', errorCode: 'tool_failed', agentId: 'reviewer' }),
  ], [
    attempt({ state: 'approval_required' }),
    attempt({ id: 'attempt-unknown', state: 'unknown', agentId: 'operator' }),
  ]);

  assert.deepEqual(summary, {
    official: 2,
    local: 2,
    agents: 3,
    active: 2,
    attention: 2,
  });
});
