import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import type { OpenClawAuditEvent, OpenClawAuditListPage } from '@/services/gateway/OpenClawAuditClient';
import {
  buildDingTalkAuditQuery,
  classifyDingTalkAuditFailure,
  type DingTalkAuditFailureKind,
} from '@/business-applications/dingtalkAuditAvailability';

const DINGTALK_TOOL_PREFIX = 'junqi_dingtalk_';

export type DingTalkAuditPage = {
  readonly sessionKey: string;
  readonly events: readonly OpenClawAuditEvent[];
  readonly nextCursor: string | null;
  readonly source: OpenClawAuditListPage['source'] | null;
};

export type DingTalkAuditVisibleState = {
  readonly events: readonly OpenClawAuditEvent[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly unavailable: boolean;
  readonly failure: DingTalkAuditFailureKind | null;
  readonly nextCursor: string | null;
  readonly source: OpenClawAuditListPage['source'] | null;
};

const EMPTY_DINGTALK_AUDIT_PAGE: DingTalkAuditPage = {
  sessionKey: '',
  events: [],
  nextCursor: null,
  source: null,
};

function emptyDingTalkAuditPage(sessionKey: string): DingTalkAuditPage {
  return sessionKey ? { ...EMPTY_DINGTALK_AUDIT_PAGE, sessionKey } : EMPTY_DINGTALK_AUDIT_PAGE;
}

/** 只有同一 Session 的刷新失败才能保留账本，不能把旧会话记录投影到新会话。 */
export function retainDingTalkAuditPageOnRefreshFailure(
  current: DingTalkAuditPage,
  sessionKey: string,
): DingTalkAuditPage {
  return current.sessionKey === sessionKey ? current : emptyDingTalkAuditPage(sessionKey);
}

/** 连接或会话身份变化时立即撤回旧账本，等待官方账本再次确认后才重新发布。 */
export function selectDingTalkAuditVisibleState({
  connected,
  sessionKey,
  page,
  loading,
  loadingMore,
  failure,
}: {
  connected: boolean;
  sessionKey: string;
  page: DingTalkAuditPage;
  loading: boolean;
  loadingMore: boolean;
  failure: DingTalkAuditFailureKind | null;
}): DingTalkAuditVisibleState {
  const normalizedSessionKey = sessionKey.trim();
  const pageMatchesCurrentSession = page.sessionKey === normalizedSessionKey;
  const pageIsCurrent = connected && pageMatchesCurrentSession;
  const immediateFailure = connected ? null : 'disconnected' as const;
  return {
    events: pageIsCurrent ? page.events : EMPTY_DINGTALK_AUDIT_PAGE.events,
    loading: loading || (connected && Boolean(normalizedSessionKey) && !pageMatchesCurrentSession),
    loadingMore: pageIsCurrent ? loadingMore : false,
    unavailable: pageIsCurrent && failure !== null,
    failure: immediateFailure ?? (pageMatchesCurrentSession ? failure : null),
    nextCursor: pageIsCurrent ? page.nextCursor : null,
    source: pageIsCurrent ? page.source : null,
  };
}

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
  const [page, setPage] = useState<DingTalkAuditPage>(EMPTY_DINGTALK_AUDIT_PAGE);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<DingTalkAuditFailureKind | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    const requestedSessionKey = sessionKey.trim();
    if (!connected) {
      setPage(emptyDingTalkAuditPage(requestedSessionKey));
      setFailure('disconnected');
      setLoading(false);
      return;
    }
    const query = buildDingTalkAuditQuery(sessionKey);
    if (!query) {
      setPage(EMPTY_DINGTALK_AUDIT_PAGE);
      setFailure('session-missing');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const page = await gateway.listAuditEvents(query);
      if (requestGeneration !== generation.current) return;
      setPage({
        sessionKey: query.sessionKey ?? requestedSessionKey,
        events: selectDingTalkAuditEvents(page.events),
        nextCursor: page.nextCursor ?? null,
        source: page.source,
      });
      setFailure(null);
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      setPage((current) => retainDingTalkAuditPageOnRefreshFailure(current, query.sessionKey ?? requestedSessionKey));
      setFailure(classifyDingTalkAuditFailure(true, error));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [connected, sessionKey]);

  const loadMore = useCallback(async () => {
    const cursor = page.nextCursor;
    const requestedSessionKey = sessionKey.trim();
    if (!connected || page.sessionKey !== requestedSessionKey || !cursor || loading || loadingMore) return;
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
      setPage((current) => current.source === page.source
        ? {
          sessionKey: current.sessionKey,
          events: selectDingTalkAuditEvents([...current.events, ...page.events]),
          nextCursor: page.nextCursor ?? null,
          source: current.source,
        }
        : {
          sessionKey: query.sessionKey ?? requestedSessionKey,
          events: selectDingTalkAuditEvents(page.events),
          nextCursor: page.nextCursor ?? null,
          source: page.source,
        });
      setFailure(null);
    } catch (error) {
      if (requestGeneration === generation.current) setFailure(classifyDingTalkAuditFailure(true, error));
    } finally {
      setLoadingMore(false);
    }
  }, [connected, loading, loadingMore, page.nextCursor, sessionKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  return {
    ...selectDingTalkAuditVisibleState({
      connected,
      sessionKey,
      page,
      loading,
      loadingMore,
      failure,
    }),
    refresh,
    loadMore,
  };
}
