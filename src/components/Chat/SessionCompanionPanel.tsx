import { FormEvent, useEffect, useRef } from 'react';
import { BotMessageSquare, LoaderCircle, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showConfirm } from '@/components/shared/AlertDialog';
import { ChatSidePanel } from './ChatSidePanel';
import { useOpenClawSessionCompanion } from '@/hooks/useOpenClawSessionCompanion';

interface SessionCompanionPanelProps {
  readonly sessionKey: string;
  readonly connected: boolean;
  readonly initialQuestion?: string;
  readonly onClose: () => void;
}

/** 侧栏只呈现 Gateway 的只读 Companion 线程，绝不写入当前会话 transcript。 */
export function SessionCompanionPanel({ sessionKey, connected, initialQuestion, onClose }: SessionCompanionPanelProps) {
  const { t, i18n } = useTranslation();
  const thread = useOpenClawSessionCompanion(sessionKey, connected);
  const exchangesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialQuestion !== undefined) thread.setDraft(initialQuestion);
  }, [initialQuestion, thread.setDraft]);

  useEffect(() => {
    exchangesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.exchanges.length, thread.pendingQuestion, thread.failedQuestion]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void thread.ask();
  };

  const clear = () => {
    showConfirm(
      t('chat.sessionCompanion.clearTitle'),
      t('chat.sessionCompanion.clearDescription'),
      async () => { await thread.reset(); },
    );
  };

  const failureLabel = thread.failure === 'busy'
    ? t('chat.sessionCompanion.busy')
    : thread.failure === 'unavailable'
      ? t('chat.sessionCompanion.unavailable')
      : thread.failure === 'invalid'
        ? t('chat.sessionCompanion.invalid')
        : null;

  return (
    <ChatSidePanel
      title={t('chat.sessionCompanion.title')}
      titleId="session-companion-title"
      closeLabel={t('chat.sessionCompanion.close')}
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start gap-2 border-b border-aegis-border/55 px-4 py-3 text-[11px] leading-5 text-aegis-text-dim">
          <BotMessageSquare size={15} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
          <p>{t('chat.sessionCompanion.description')}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
          {thread.loading && thread.exchanges.length === 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-aegis-text-dim">
              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
              {t('chat.sessionCompanion.loading')}
            </div>
          ) : thread.exchanges.length === 0 && !thread.pendingQuestion && !thread.failedQuestion ? (
            <p className="text-[12px] leading-5 text-aegis-text-dim">{t('chat.sessionCompanion.empty')}</p>
          ) : (
            <div className="space-y-3">
              {thread.exchanges.map((exchange) => (
                <article key={`${exchange.ts}:${exchange.question}`} className="border border-aegis-border/55 bg-aegis-bg/35 px-3 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-[11px] text-aegis-text-muted">{exchange.question}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-aegis-text">{exchange.answer}</p>
                  <time className="mt-2 block text-[10px] text-aegis-text-dim" dateTime={new Date(exchange.ts).toISOString()}>
                    {new Date(exchange.ts).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </article>
              ))}
              {thread.pendingQuestion && (
                <article className="border border-aegis-primary/25 bg-aegis-primary/[0.04] px-3 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-[11px] text-aegis-text-muted">{thread.pendingQuestion}</p>
                  <p className="mt-2 flex items-center gap-2 text-[11px] text-aegis-primary">
                    <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                    {t('chat.sessionCompanion.answering')}
                  </p>
                </article>
              )}
              {thread.failedQuestion && failureLabel && (
                <article className="border border-aegis-warning/35 bg-aegis-warning/[0.05] px-3 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-[11px] text-aegis-text-muted">{thread.failedQuestion}</p>
                  <p className="mt-2 text-[11px] leading-5 text-aegis-warning">{failureLabel}</p>
                </article>
              )}
            </div>
          )}
          <div ref={exchangesEndRef} />
        </div>

        <form className="shrink-0 border-t border-aegis-border p-3" onSubmit={submit}>
          <label className="sr-only" htmlFor="session-companion-question">{t('chat.sessionCompanion.inputLabel')}</label>
          <textarea
            id="session-companion-question"
            value={thread.draft}
            maxLength={400}
            rows={3}
            disabled={!connected || thread.loading || thread.pendingQuestion !== null}
            onChange={(event) => thread.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void thread.ask();
              }
            }}
            placeholder={t('chat.sessionCompanion.placeholder')}
            className="block w-full resize-none border border-aegis-border bg-aegis-bg px-2.5 py-2 text-[12px] leading-5 text-aegis-text placeholder:text-aegis-text-dim focus:border-aegis-primary/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={clear}
              disabled={!connected || thread.loading || thread.pendingQuestion !== null || thread.exchanges.length === 0}
              className="grid size-8 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger disabled:cursor-not-allowed disabled:opacity-40"
              title={t('chat.sessionCompanion.clear')}
              aria-label={t('chat.sessionCompanion.clear')}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void thread.refresh()}
              disabled={!connected || thread.loading || thread.pendingQuestion !== null}
              className="grid size-8 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
              title={t('chat.sessionCompanion.refresh')}
              aria-label={t('chat.sessionCompanion.refresh')}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            <button
              type="submit"
              disabled={!connected || thread.loading || thread.pendingQuestion !== null || !thread.draft.trim()}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[11px] font-medium text-aegis-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={13} aria-hidden="true" />
              {t('chat.sessionCompanion.ask')}
            </button>
          </div>
        </form>
      </div>
    </ChatSidePanel>
  );
}
