import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type { ChatResponseAuditState } from '@/hooks/useChatResponseAudit';
import { formatTraceTimestamp } from './chatResponseTracePresentation';

export function ChatResponseTraceAuditSection({ audit }: { audit: ChatResponseAuditState }) {
  const { t, i18n } = useTranslation();

  return (
    <section className="border-b border-aegis-border px-4 py-3" aria-label={t('chat.trace.auditSection')}>
      <div className="flex items-start gap-2">
        <ClipboardList size={14} className="mt-0.5 shrink-0 text-aegis-text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-aegis-text">
            {t('chat.trace.auditSection')}
            {audit.loading && <LoadingIndicator size={12} className="text-aegis-text-dim" label={t('common.loading')} />}
          </div>
          {audit.unavailable && (
            <p className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
              {t('chat.trace.auditUnavailable')}
            </p>
          )}
          {!audit.loading && !audit.unavailable && audit.events.length === 0 && (
            <p className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
              {t('chat.trace.auditEmpty')}
            </p>
          )}
          {audit.events.length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {audit.events.map((event) => (
                <li key={event.eventId} className="rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)] px-2 py-1.5 text-[10px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-aegis-text-muted">
                      {event.toolName || event.action}
                    </span>
                    <span className="shrink-0 text-aegis-text-dim">
                      {t(`chat.trace.auditStatus.${event.status}`, event.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-aegis-text-dim">
                    <span>{formatTraceTimestamp(event.occurredAt, i18n.language)}</span>
                    <span>{t('chat.trace.auditAgent')}: {event.agentId}</span>
                    <span>{t('chat.trace.auditRedaction')}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
