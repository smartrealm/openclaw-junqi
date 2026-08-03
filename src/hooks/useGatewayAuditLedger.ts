import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import {
  listAuditLedger,
  type AuditKind,
  type AuditStatus,
  type OpenClawAuditEvent,
} from '@/services/gateway/auditLedger';
import { useVisibleInterval } from './useVisibleInterval';

interface GatewayAuditLedgerState {
  loading: boolean;
  loadingMore: boolean;
  events: OpenClawAuditEvent[];
  nextCursor?: string;
  unavailable: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const PAGE_SIZE = 100;

export function useGatewayAuditLedger(
  filters: { kind?: AuditKind; status?: AuditStatus } = {},
): GatewayAuditLedgerState {
  const connected = useChatStore((state) => state.connected);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [events, setEvents] = useState<OpenClawAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!connected) {
      setEvents([]);
      setNextCursor(undefined);
      setUnavailable(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const page = await listAuditLedger(
        (method, params) => gateway.call(method, params),
        { ...filters, limit: PAGE_SIZE },
      );
      if (requestGeneration !== generation.current) return;
      setEvents(page.events);
      setNextCursor(page.nextCursor);
      setUnavailable(false);
    } catch {
      if (requestGeneration !== generation.current) return;
      setEvents([]);
      setNextCursor(undefined);
      setUnavailable(true);
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [connected, filters.kind, filters.status]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!connected || !cursor || loading || loadingMore) return;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    try {
      const page = await listAuditLedger(
        (method, params) => gateway.call(method, params),
        { ...filters, limit: PAGE_SIZE, cursor },
      );
      if (requestGeneration !== generation.current) return;
      setEvents((current) => [...current, ...page.events]);
      setNextCursor(page.nextCursor);
      setUnavailable(false);
    } catch {
      if (requestGeneration === generation.current) setUnavailable(true);
    } finally {
      // A refresh may supersede this page request; the stale result is ignored,
      // but the local control must still leave its loading state.
      setLoadingMore(false);
    }
  }, [connected, filters.kind, filters.status, loading, loadingMore, nextCursor]);

  useEffect(() => { void refresh(); }, [refresh]);
  useVisibleInterval(() => { void refresh(); }, 30_000, connected, connected);

  return { loading, loadingMore, events, nextCursor, unavailable, refresh, loadMore };
}
