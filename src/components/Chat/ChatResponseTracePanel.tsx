import { Activity, History, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ChatResponseTrace,
  ChatResponseTraceAuditPage,
} from './chatResponseTrace';
import { ChatSidePanel } from './ChatSidePanel';
import { StatusIcon } from '@/components/shared/StatusIcon';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { ChatResponseTraceNodeCard } from './ChatResponseTraceNodeCard';
import { formatTraceTimestamp } from './chatResponseTracePresentation';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { agentIdFromSessionKey } from '@/utils/sessionPresentation';

interface ChatResponseTracePanelProps {
  trace: ChatResponseTrace;
  onClose: () => void;
  onOpenSourceMessage: (sourceMessageId: string) => void;
  onLoadAuditEvents?: (runId: string) => Promise<ChatResponseTraceAuditPage>;
  overlay?: boolean;
}

type AuditLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; page: ChatResponseTraceAuditPage }
  | { kind: 'unsupported' }
  | { kind: 'unavailable' };

function auditErrorKind(error: unknown): 'unsupported' | 'unavailable' {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const code = (error as Record<string, unknown>).code;
    if (code === 'OPENCLAW_AUDIT_UNSUPPORTED') return 'unsupported';
  }
  return 'unavailable';
}

export function ChatResponseTracePanel({
  trace,
  onClose,
  onOpenSourceMessage,
  onLoadAuditEvents,
  overlay = false,
}: ChatResponseTracePanelProps) {
  const { t, i18n } = useTranslation();
  const formalReviewId = trace.review.formalReviewId;
  const agents = useGatewayDataStore((state) => state.agents);
  const session = useGatewayDataStore((state) => state.sessions.find((candidate) => candidate.key === trace.sessionKey));
  const agentId = agentIdFromSessionKey(trace.sessionKey);
  const agent = agents.find((candidate) => candidate.id === agentId);
  const agentName = getAgentDisplayName(agent, t('chat.trace.notProvided'));
  const sessionLabel = session?.label?.trim();
  const conversationName = sessionLabel && sessionLabel !== trace.sessionKey
    ? sessionLabel
    : t('chat.trace.currentConversation');
  const titleId = `chat-trace-title-${trace.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const [auditState, setAuditState] = useState<AuditLoadState>({ kind: 'idle' });
  const status = trace.status === 'final'
    ? 'completed'
    : trace.status === 'streaming'
      ? 'running'
      : trace.status === 'aborted'
        ? 'cancelled'
        : 'error';

  useEffect(() => {
    let active = true;
    if (!trace.runId) {
      setAuditState({ kind: 'idle' });
      return () => { active = false; };
    }
    if (!onLoadAuditEvents) {
      setAuditState({ kind: 'unavailable' });
      return () => { active = false; };
    }
    setAuditState({ kind: 'loading' });
    void onLoadAuditEvents(trace.runId)
      .then((page) => {
        if (active) setAuditState({ kind: 'loaded', page });
      })
      .catch((error: unknown) => {
        if (active) setAuditState({ kind: auditErrorKind(error) });
      });
    return () => { active = false; };
  }, [onLoadAuditEvents, trace.runId]);

  return (
    <ChatSidePanel
      title={t('chat.trace.title')}
      titleId={titleId}
      closeLabel={t('chat.trace.close')}
      onClose={onClose}
      overlay={overlay}
    >
      <div className="min-h-0 flex-1 overflow-y-auto chat-scrollbar" data-chat-response-trace={trace.id}>
        <section className="border-b border-aegis-border px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} size={14} />
            <span className="text-[11px] font-semibold text-aegis-text">{t(`chat.trace.status.${trace.status}`)}</span>
            <span className="ml-auto text-[9.5px] text-aegis-text-dim">
              {t(trace.authority === 'openclaw-run' ? 'chat.trace.openClawAuthority' : 'chat.trace.transcriptAuthority')}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[10px]">
            <dt className="text-aegis-text-dim">{t('chat.trace.agent')}</dt>
            <dd className="text-aegis-text-muted">{agentName}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.conversation')}</dt>
            <dd className="text-aegis-text-muted">{conversationName}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.startedAt')}</dt>
            <dd className="text-aegis-text-muted">{formatTraceTimestamp(trace.startedAt, i18n.language)}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.completedAt')}</dt>
            <dd className="text-aegis-text-muted">
              {trace.completedAt === undefined
                ? t('chat.trace.notProvided')
                : formatTraceTimestamp(trace.completedAt, i18n.language)}
            </dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.sourceRecords')}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {trace.sourceMessageIds.map((sourceMessageId, index) => (
                <button
                  key={sourceMessageId}
                  type="button"
                  onClick={() => onOpenSourceMessage(sourceMessageId)}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary"
                >
                  {t('chat.trace.sourceRecord', { number: index + 1 })}
                </button>
              ))}
            </dd>
          </dl>
          <details className="mt-3 border-t border-aegis-border/70 pt-2 text-[9px] text-aegis-text-dim">
            <summary className="cursor-pointer select-none rounded px-1 py-0.5 hover:bg-aegis-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary">{t('chat.trace.technicalDetails')}</summary>
            <dl className="mt-2 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-aegis-hover/25 px-2 py-1.5 font-mono">
              <dt>{t('chat.trace.sessionKey')}</dt>
              <dd className="break-all">{trace.sessionKey}</dd>
              <dt>{t('chat.trace.run')}</dt>
              <dd className="break-all">{trace.runId || t('chat.trace.notProvided')}</dd>
              <dt>{t('chat.trace.traceId')}</dt>
              <dd className="break-all">{trace.id}</dd>
              {formalReviewId && (
                <>
                  <dt>{t('chat.trace.formalReviewId')}</dt>
                  <dd className="break-all">{formalReviewId}</dd>
                </>
              )}
            </dl>
          </details>
        </section>

        <section className="border-b border-aegis-border px-4 py-3" aria-label={t('chat.trace.reviewSection')}>
          <div className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-aegis-text-muted" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-aegis-text">{t('chat.trace.reviewSection')}</div>
              <p className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
                {trace.review.status === 'requested'
                  ? formalReviewId
                    ? t('chat.trace.reviewFormalRelation')
                    : t('chat.trace.reviewTranscriptOnly', { count: trace.review.requestCount })
                  : t('chat.trace.reviewNotRequested')}
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-aegis-border px-4 py-3" aria-label={t('chat.trace.audit.title')}>
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-aegis-text-muted" />
            <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.trace.audit.title')}</h3>
            {auditState.kind === 'loaded' && (
              <span className="text-[10px] text-aegis-text-dim">{auditState.page.events.length}</span>
            )}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-aegis-text-muted">
            {t('chat.trace.audit.metadataOnly')}
          </p>
          {auditState.kind === 'idle' && !trace.runId && (
            <p className="mt-2 text-[10px] text-aegis-text-dim">{t('chat.trace.audit.noRun')}</p>
          )}
          {auditState.kind === 'loading' && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-aegis-text-dim" role="status">
              <LoadingIndicator size={11} />
              {t('chat.trace.audit.loading')}
            </p>
          )}
          {auditState.kind === 'unsupported' && (
            <p className="mt-2 text-[10px] text-aegis-text-dim">{t('chat.trace.audit.unsupported')}</p>
          )}
          {auditState.kind === 'unavailable' && (
            <p className="mt-2 text-[10px] text-aegis-text-dim">{t('chat.trace.audit.unavailable')}</p>
          )}
          {auditState.kind === 'loaded' && (
            <>
              <div className="mt-2 flex items-center justify-between text-[9px] text-aegis-text-dim">
                <span>{t(`chat.trace.audit.source.${auditState.page.source}`)}</span>
                {auditState.page.nextCursor && <span>{t('chat.trace.audit.moreAvailable')}</span>}
              </div>
              {auditState.page.events.length === 0 ? (
                <p className="mt-2 text-[10px] text-aegis-text-dim">{t('chat.trace.audit.empty')}</p>
              ) : (
                <ol className="mt-2 space-y-1.5">
                  {auditState.page.events.map((event) => (
                    <li key={`${event.eventId}-${event.sequence}`} className="rounded-md border border-aegis-border/70 bg-[rgb(var(--aegis-overlay)/0.025)] px-2.5 py-2">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[10px] font-medium text-aegis-text">
                          {t(`chat.trace.audit.kind.${event.kind}`)} · {event.action}
                        </span>
                        <span className="shrink-0 text-[9px] text-aegis-text-dim">
                          {t(`chat.trace.audit.status.${event.status}`)}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[9px] text-aegis-text-dim">
                        <span>{t('chat.trace.audit.recorded')}</span>
                        <span className="text-aegis-text-muted">{formatTraceTimestamp(event.occurredAt, i18n.language)}</span>
                        <span>{t('chat.trace.audit.actor')}</span>
                        <span className="break-all text-aegis-text-muted">{event.actor.type}:{event.actor.id}</span>
                        {event.toolName && (
                          <>
                            <span>{t('chat.trace.audit.tool')}</span>
                            <span className="break-all text-aegis-text-muted">{event.toolName}</span>
                          </>
                        )}
                        <span>{t('chat.trace.audit.sequence')}</span>
                        <span className="text-aegis-text-muted">{event.sequence}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>

        <section className="px-4 py-3" aria-label={t('chat.trace.timeline')}>
          <div className="mb-3 flex items-center gap-2">
            <History size={14} className="text-aegis-text-muted" />
            <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.trace.timeline')}</h3>
            <span className="text-[10px] text-aegis-text-dim">{trace.nodes.length}</span>
          </div>
          <ol className="space-y-2">
            {trace.nodes.map((node) => (
              <ChatResponseTraceNodeCard
                key={node.id}
                node={node}
                onOpenSourceMessage={() => onOpenSourceMessage(node.sourceMessageId)}
              />
            ))}
          </ol>
        </section>
      </div>
    </ChatSidePanel>
  );
}
