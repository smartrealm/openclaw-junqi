import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/stores/chatStore';
import { ChatMarkdownRenderer } from './ChatMarkdownRenderer';
import { ChatSidePanel } from './ChatSidePanel';
import { formatTraceTimestamp } from './chatResponseTracePresentation';

interface ChatTraceSourceMessagePanelProps {
  sourceMessageId: string;
  message?: ChatMessage;
  onBack: () => void;
  onClose: () => void;
  overlay?: boolean;
}

function sourceRecordContent(message: ChatMessage | undefined): string | null {
  if (!message) return null;
  return message.content.trim() || message.toolOutput?.trim() || message.thinkingContent?.trim() || null;
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
  const content = sourceRecordContent(message);

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
            </dl>
            <div className="markdown-body text-[14px] leading-relaxed">
              <ChatMarkdownRenderer markdown={content} />
            </div>
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
