import { History, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatResponseTrace } from './chatResponseTrace';
import { ChatSidePanel } from './ChatSidePanel';
import { StatusIcon } from '@/components/shared/StatusIcon';
import { ChatResponseTraceNodeCard } from './ChatResponseTraceNodeCard';
import { formatTraceTimestamp } from './chatResponseTracePresentation';

interface ChatResponseTracePanelProps {
  trace: ChatResponseTrace;
  onClose: () => void;
  overlay?: boolean;
}

export function ChatResponseTracePanel({
  trace,
  onClose,
  overlay = false,
}: ChatResponseTracePanelProps) {
  const { t, i18n } = useTranslation();
  const formalReviewId = trace.review.formalReviewId;
  const titleId = `chat-trace-title-${trace.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const status = trace.status === 'final'
    ? 'completed'
    : trace.status === 'streaming'
      ? 'running'
      : trace.status === 'aborted'
        ? 'cancelled'
        : 'error';

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
            <dt className="text-aegis-text-dim">{t('chat.trace.session')}</dt>
            <dd className="break-all font-mono text-aegis-text-muted">{trace.sessionKey}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.run')}</dt>
            <dd className="break-all font-mono text-aegis-text-muted">{trace.runId || t('chat.trace.notProvided')}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.traceId')}</dt>
            <dd className="break-all font-mono text-aegis-text-muted">{trace.id}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.startedAt')}</dt>
            <dd className="text-aegis-text-muted">{formatTraceTimestamp(trace.startedAt, i18n.language)}</dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.completedAt')}</dt>
            <dd className="text-aegis-text-muted">
              {trace.completedAt === undefined
                ? t('chat.trace.notProvided')
                : formatTraceTimestamp(trace.completedAt, i18n.language)}
            </dd>
            <dt className="text-aegis-text-dim">{t('chat.trace.sourceMessages')}</dt>
            <dd>
              <details className="text-aegis-text-muted">
                <summary className="cursor-pointer select-none">{trace.sourceMessageIds.length}</summary>
                <div className="mt-1 space-y-1">
                  {trace.sourceMessageIds.map((id) => <div key={id} className="break-all font-mono text-[9px] text-aegis-text-dim">{id}</div>)}
                </div>
              </details>
            </dd>
            {formalReviewId && (
              <>
                <dt className="text-aegis-text-dim">{t('chat.trace.formalReviewId')}</dt>
                <dd className="break-all font-mono text-aegis-text-muted">{formalReviewId}</dd>
              </>
            )}
          </dl>
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

        <section className="px-4 py-3" aria-label={t('chat.trace.timeline')}>
          <div className="mb-3 flex items-center gap-2">
            <History size={14} className="text-aegis-text-muted" />
            <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.trace.timeline')}</h3>
            <span className="text-[10px] text-aegis-text-dim">{trace.nodes.length}</span>
          </div>
          <ol className="space-y-2">
            {trace.nodes.map((node) => <ChatResponseTraceNodeCard key={node.id} node={node} />)}
          </ol>
        </section>
      </div>
    </ChatSidePanel>
  );
}
