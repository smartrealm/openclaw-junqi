import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/stores/chatStore';
import { ChatMarkdownRenderer } from './ChatMarkdownRenderer';
import { ChatSidePanel } from './ChatSidePanel';
import { formatTraceTimestamp } from './chatResponseTracePresentation';
import { resolveTraceSourceRecordContent } from './chatTraceSourceMessagePresentation';

interface ChatTraceSourceMessagePanelProps {
  sourceMessageId: string;
  message?: ChatMessage;
  onBack: () => void;
  onClose: () => void;
  overlay?: boolean;
}

function formatStructuredValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StructuredToolOutput({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] p-3 font-mono text-[11px] leading-5 text-aegis-text-secondary">{formatStructuredValue(value)}</pre>;
  }
  if (!value || typeof value !== 'object') {
    return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] p-3 font-mono text-[11px] leading-5 text-aegis-text-secondary">{String(value)}</pre>;
  }

  return (
    <dl className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px]">
      {Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => (
        <div key={key} className="col-span-2 grid grid-cols-subgrid items-start">
          <dt className="break-words font-mono text-aegis-text-dim">{key}</dt>
          <dd className="min-w-0 text-aegis-text-secondary">
            {typeof fieldValue === 'string' ? (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] p-3 font-mono text-[11px] leading-5">{fieldValue}</pre>
            ) : (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] p-3 font-mono text-[11px] leading-5">{formatStructuredValue(fieldValue)}</pre>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ChatTraceSourceMessagePanel({
  sourceMessageId,
  message,
  onBack,
  onClose,
  overlay = false,
}: ChatTraceSourceMessagePanelProps) {
  const { t, i18n } = useTranslation();
  const titleId = `chat-trace-source-title-${sourceMessageId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const content = resolveTraceSourceRecordContent(message);

  return (
    <ChatSidePanel
      title={t('chat.trace.sourceRecordTitle')}
      titleId={titleId}
      closeLabel={t('chat.trace.close')}
      onClose={onClose}
      backLabel={t('chat.trace.backToTrace')}
      onBack={onBack}
      overlay={overlay}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 chat-scrollbar">
        {message && content ? (
          <article className="mx-auto w-full max-w-[760px]">
            <dl className="mb-5 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[10px]">
              <dt className="text-aegis-text-dim">{t('chat.trace.recordRole')}</dt>
              <dd className="text-aegis-text-muted">{t(`chat.trace.recordRoleValue.${message.role}`)}</dd>
              <dt className="text-aegis-text-dim">{t('chat.trace.recordTime')}</dt>
              <dd className="text-aegis-text-muted">{formatTraceTimestamp(message.timestamp, i18n.language)}</dd>
              {message.toolName && (
                <>
                  <dt className="text-aegis-text-dim">{t('chat.trace.tool')}</dt>
                  <dd className="break-words text-aegis-text-muted">{message.toolName}</dd>
                </>
              )}
            </dl>
            {content.kind === 'tool-output' ? (
              <section aria-label={t('chat.trace.output')}>
                {message.toolInput && (
                  <details className="mb-4 text-[11px] text-aegis-text-muted">
                    <summary className="cursor-pointer select-none text-aegis-text-secondary">{t('chat.trace.input')}</summary>
                    <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] p-3 font-mono text-[11px] leading-5">{formatStructuredValue(message.toolInput)}</pre>
                  </details>
                )}
                {content.structured === null ? (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] p-3 font-mono text-[11px] leading-5 text-aegis-text-secondary">{content.text}</pre>
                ) : (
                  <StructuredToolOutput value={content.structured} />
                )}
              </section>
            ) : (
              <div className="markdown-body text-[14px] leading-relaxed">
                <ChatMarkdownRenderer markdown={content.text} />
              </div>
            )}
            <details className="mt-6 border-t border-aegis-border pt-3 text-[10px] text-aegis-text-dim">
              <summary className="cursor-pointer select-none">{t('chat.trace.technicalDetails')}</summary>
              <dl className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono">
                <dt>{t('chat.trace.sourceMessage')}</dt>
                <dd className="break-all">{sourceMessageId}</dd>
                {message.nativeMessageId && (
                  <>
                    <dt>{t('chat.trace.nativeMessageId')}</dt>
                    <dd className="break-all">{message.nativeMessageId}</dd>
                  </>
                )}
              </dl>
            </details>
          </article>
        ) : (
          <section className="mx-auto w-full max-w-[520px] py-8 text-center">
            <h3 className="text-[13px] font-semibold text-aegis-text">{t('chat.trace.sourceRecordUnavailable')}</h3>
            <p className="mt-2 text-[11px] leading-5 text-aegis-text-muted">
              {t('chat.trace.sourceRecordUnavailableDescription')}
            </p>
            <details className="mt-5 text-left text-[10px] text-aegis-text-dim">
              <summary className="cursor-pointer select-none">{t('chat.trace.technicalDetails')}</summary>
              <div className="mt-2 break-all font-mono">{sourceMessageId}</div>
            </details>
          </section>
        )}
      </div>
    </ChatSidePanel>
  );
}
