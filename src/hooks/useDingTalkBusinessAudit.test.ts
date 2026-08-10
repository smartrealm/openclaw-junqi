import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDingTalkAuditEvents } from './useDingTalkBusinessAudit';

test('keeps only official DingTalk tool audit events in reverse sequence order', () => {
  const events = selectDingTalkAuditEvents([
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'other', sequence: 1, sourceSequence: 1, occurredAt: 1, kind: 'tool_action', action: 'tool.action.finished', status: 'succeeded', actor: { type: 'agent', id: 'main' }, redaction: 'metadata_only', agentId: 'main', toolName: 'other_tool' },
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'older', sequence: 2, sourceSequence: 2, occurredAt: 2, kind: 'tool_action', action: 'tool.action.finished', status: 'succeeded', actor: { type: 'agent', id: 'legal' }, redaction: 'metadata_only', agentId: 'legal', toolName: 'junqi_dingtalk_todo_list' },
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'older', sequence: 2, sourceSequence: 2, occurredAt: 2, kind: 'tool_action', action: 'tool.action.finished', status: 'succeeded', actor: { type: 'agent', id: 'legal' }, redaction: 'metadata_only', agentId: 'legal', toolName: 'junqi_dingtalk_todo_list' },
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'newer', sequence: 3, sourceSequence: 3, occurredAt: 3, kind: 'tool_action', action: 'tool.action.started', status: 'started', actor: { type: 'agent', id: 'dws' }, redaction: 'metadata_only', agentId: 'dws', toolName: 'junqi_dingtalk_contact_me' },
  ]);
  assert.deepEqual(events.map((event) => event.eventId), ['newer', 'older']);
});
