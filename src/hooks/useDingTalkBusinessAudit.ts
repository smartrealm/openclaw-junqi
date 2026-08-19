import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import type { OpenClawAuditEvent } from '@/services/gateway/OpenClawAuditClient';
import {
  buildDingTalkAuditQuery,
  classifyDingTalkAuditFailure,
  type DingTalkAuditFailureKind,
} from '@/business-applications/dingtalkAuditAvailability';

const DINGTALK_TOOL_PREFIX = 'junqi_dingtalk_';

export function selectDingTalkAuditEvents(events: readonly OpenClawAuditEvent[]): readonly OpenClawAuditEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => event.kind === 'tool_action' && event.toolName?.startsWith(DINGTALK_TOOL_PREFIX))
    .filter((event) => {
      const key = `${event.source}:${event.eventId}:${event.sequence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.sequence - left.sequence);
}

export function useDingTalkBusinessAudit(sessionKey: string) {
  const connected = useChatStore((state) => state.connected);
  const [events, setEvents] = useState<readonly OpenClawAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<DingTalkAuditFailureKind | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!connected) {
      setEvents([]);
      setNextCursor(null);
      setFailure('disconnected');
      setLoading(false);
      return;
    }
    const query = buildDingTalkAuditQuery(sessionKey);
    if (!query) {
      setEvents([]);
      setNextCursor(null);
      setFailure('session-missing');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const page = await gateway.listAuditEvents(query);
      if (requestGeneration !== generation.current) return;
      setEvents(selectDingTalkAuditEvents(page.events));
      setNextCursor(page.nextCursor ?? null);
      setFailure(null);
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      setEvents([]);
      setNextCursor(null);
      setFailure(classifyDingTalkAuditFailure(true, error));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [connected, sessionKey]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!connected || !cursor || loading || loadingMore) return;
    const query = buildDingTalkAuditQuery(sessionKey, cursor);
    if (!query) {
      setFailure('session-missing');
      return;
    }
    const requestGeneration = generation.current;
    setLoadingMore(true);
    try {
      const page = await gateway.listAuditEvents(query);
      if (requestGeneration !== generation.current) return;
      setEvents((current) => selectDingTalkAuditEvents([...current, ...page.events]));
      setNextCursor(page.nextCursor ?? null);
      setFailure(null);
    } catch (error) {
      if (requestGeneration === generation.current) setFailure(classifyDingTalkAuditFailure(true, error));
    } finally {
      setLoadingMore(false);
    }
  }, [connected, loading, loadingMore, nextCursor, sessionKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  return {
    events,
    loading,
    loadingMore,
    unavailable: failure !== null,
    failure,
    nextCursor,
    refresh,
    loadMore,
  };
}
