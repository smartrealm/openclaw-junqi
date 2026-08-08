import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import type { OpenClawAuditEvent } from '@/services/gateway/OpenClawAuditClient';

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

export function useDingTalkBusinessAudit() {
  const connected = useChatStore((state) => state.connected);
  const [events, setEvents] = useState<readonly OpenClawAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!connected) {
      setEvents([]);
      setNextCursor(null);
      setUnavailable(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const page = await gateway.listAuditEvents({ kind: 'tool_action', limit: 100 });
      if (requestGeneration !== generation.current) return;
      setEvents(selectDingTalkAuditEvents(page.events));
      setNextCursor(page.nextCursor ?? null);
      setUnavailable(false);
    } catch {
      if (requestGeneration !== generation.current) return;
      setEvents([]);
      setNextCursor(null);
      setUnavailable(true);
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [connected]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!connected || !cursor || loading || loadingMore) return;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    try {
      const page = await gateway.listAuditEvents({ kind: 'tool_action', limit: 100, cursor });
      if (requestGeneration !== generation.current) return;
      setEvents((current) => selectDingTalkAuditEvents([...current, ...page.events]));
      setNextCursor(page.nextCursor ?? null);
      setUnavailable(false);
    } catch {
      if (requestGeneration === generation.current) setUnavailable(true);
    } finally {
      setLoadingMore(false);
    }
  }, [connected, loading, loadingMore, nextCursor]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { events, loading, loadingMore, unavailable, nextCursor, refresh, loadMore };
}
