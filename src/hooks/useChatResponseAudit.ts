import { useEffect, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import {
  latestAgentRunTerminalStatus,
  listAuditEvents,
  type AuditStatus,
  type OpenClawAuditEvent,
} from '@/services/gateway/auditLedger';

export interface ChatResponseAuditState {
  loading: boolean;
  events: OpenClawAuditEvent[];
  unavailable: boolean;
  terminalStatus: AuditStatus | null;
}

const EMPTY_STATE: ChatResponseAuditState = {
  loading: false,
  events: [],
  unavailable: false,
  terminalStatus: null,
};

export function useChatResponseAudit(runId: string | null): ChatResponseAuditState {
  const connected = useChatStore((state) => state.connected);
  const [state, setState] = useState<ChatResponseAuditState>(EMPTY_STATE);

  useEffect(() => {
    let current = true;
    if (!runId || !connected) {
      setState({
        loading: false,
        events: [],
        unavailable: Boolean(runId) && !connected,
        terminalStatus: null,
      });
      return () => { current = false; };
    }

    setState({ loading: true, events: [], unavailable: false, terminalStatus: null });
    void listAuditEvents((method, params) => gateway.call(method, params), { runId, limit: 100 })
      .then((page) => {
        if (current) {
          setState({
            loading: false,
            events: page.events,
            unavailable: false,
            terminalStatus: latestAgentRunTerminalStatus(page.events),
          });
        }
      })
      .catch(() => {
        // Audit is an optional operator.read projection. A missing scope,
        // disabled ledger, or older Gateway must not hide the transcript.
        if (current) {
          setState({ loading: false, events: [], unavailable: true, terminalStatus: null });
        }
      });

    return () => { current = false; };
  }, [connected, runId]);

  return state;
}
