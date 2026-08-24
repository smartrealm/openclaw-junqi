import assert from 'node:assert/strict';
import test from 'node:test';
import {
  retainDingTalkAuditPageOnRefreshFailure,
  selectDingTalkAuditVisibleState,
  selectDingTalkAuditEvents,
  type DingTalkAuditPage,
} from './useDingTalkBusinessAudit';

test('keeps only official DingTalk tool audit events in reverse sequence order', () => {
  const events = selectDingTalkAuditEvents([
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'other', sequence: 1, sourceSequence: 1, occurredAt: 1, kind: 'tool_action', action: 'tool.action.finished', status: 'succeeded', actor: { type: 'agent', id: 'main' }, redaction: 'metadata_only', agentId: 'main', toolName: 'other_tool' },
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'older', sequence: 2, sourceSequence: 2, occurredAt: 2, kind: 'tool_action', action: 'tool.action.finished', status: 'succeeded', actor: { type: 'agent', id: 'legal' }, redaction: 'metadata_only', agentId: 'legal', toolName: 'junqi_dingtalk_todo_list' },
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'older', sequence: 2, sourceSequence: 2, occurredAt: 2, kind: 'tool_action', action: 'tool.action.finished', status: 'succeeded', actor: { type: 'agent', id: 'legal' }, redaction: 'metadata_only', agentId: 'legal', toolName: 'junqi_dingtalk_todo_list' },
    { source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'newer', sequence: 3, sourceSequence: 3, occurredAt: 3, kind: 'tool_action', action: 'tool.action.started', status: 'started', actor: { type: 'agent', id: 'dws' }, redaction: 'metadata_only', agentId: 'dws', toolName: 'junqi_dingtalk_contact_me' },
  ]);
  assert.deepEqual(events.map((event) => event.eventId), ['newer', 'older']);
});

test('同一 Session 刷新失败时保留已经读取的官方审计页', () => {
  const page = {
    sessionKey: 'agent:main:one',
    events: [{ source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'verified', sequence: 4, sourceSequence: 4, occurredAt: 4, kind: 'tool_action' as const, action: 'tool.action.finished', status: 'succeeded' as const, actor: { type: 'agent' as const, id: 'main' }, redaction: 'metadata_only' as const, agentId: 'main', toolName: 'junqi_dingtalk_todo_list' }],
    nextCursor: 'older-page',
    source: 'activity',
  } satisfies DingTalkAuditPage;

  assert.equal(retainDingTalkAuditPageOnRefreshFailure(page, 'agent:main:one'), page);
});

test('切换 Session 后失败不能保留上一会话的官方审计页', () => {
  const page = {
    sessionKey: 'agent:main:one',
    events: [{ source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'previous', sequence: 5, sourceSequence: 5, occurredAt: 5, kind: 'tool_action' as const, action: 'tool.action.finished', status: 'succeeded' as const, actor: { type: 'agent' as const, id: 'main' }, redaction: 'metadata_only' as const, agentId: 'main', toolName: 'junqi_dingtalk_todo_list' }],
    nextCursor: 'older-page',
    source: 'activity',
  } satisfies DingTalkAuditPage;

  assert.deepEqual(retainDingTalkAuditPageOnRefreshFailure(page, 'agent:main:two'), {
    sessionKey: 'agent:main:two',
    events: [],
    nextCursor: null,
    source: null,
  });
});

test('断开 Gateway 时不能继续展示已读取的旧审计页', () => {
  const page = {
    sessionKey: 'agent:main:one',
    events: [{ source: 'activity', eventType: 'tool_action', schemaVersion: 1, eventId: 'previous', sequence: 5, sourceSequence: 5, occurredAt: 5, kind: 'tool_action' as const, action: 'tool.action.finished', status: 'succeeded' as const, actor: { type: 'agent' as const, id: 'main' }, redaction: 'metadata_only' as const, agentId: 'main', toolName: 'junqi_dingtalk_todo_list' }],
    nextCursor: 'older-page',
    source: 'activity',
  } satisfies DingTalkAuditPage;

  assert.deepEqual(selectDingTalkAuditVisibleState({
    connected: false,
    sessionKey: 'agent:main:one',
    page,
    loading: false,
    loadingMore: true,
    failure: null,
  }), {
    events: [],
    loading: false,
    loadingMore: false,
    unavailable: false,
    failure: 'disconnected',
    nextCursor: null,
    source: null,
  });
});
