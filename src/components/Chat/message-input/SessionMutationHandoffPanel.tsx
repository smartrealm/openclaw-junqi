import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GitBranch, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import type { QueuedChatMessage } from '@/services/chat/types';

const EMPTY_QUEUE: QueuedChatMessage[] = [];

interface SessionMutationHandoffPanelProps {
  sessionKey: string;
  dir: 'ltr' | 'rtl';
}

/**
 * 仅呈现尚未提交给 OpenClaw 的会话变更交接消息。
 *
 * Gateway 已接纳的 followup、collect 等队列没有对应的稳定列表读取契约，不能混入此处。
 */
export function SessionMutationHandoffPanel({ sessionKey, dir }: SessionMutationHandoffPanelProps) {
  const { t } = useTranslation();
  const queue = useChatStore((state) => state.messageQueue[sessionKey] || EMPTY_QUEUE);
  const clearQueue = useChatStore((state) => state.clearQueue);
  const removeQueuedMessage = useChatStore((state) => state.removeQueuedMessage);
  const updateQueuedMessage = useChatStore((state) => state.updateQueuedMessage);
  const retryQueuedMessage = useChatStore((state) => state.retryQueuedMessage);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);

  useEffect(() => {
    setExpanded(false);
    setEditingId(null);
    setEditingText('');
    setDeletingId(null);
    setConfirmingClear(false);
  }, [sessionKey]);

  useEffect(() => {
    if (queue.length === 0) {
      setExpanded(false);
      setEditingId(null);
      setEditingText('');
      setDeletingId(null);
      setConfirmingClear(false);
      setWaitSeconds(null);
      return;
    }
    const timestamp = queue[0]?.timestamp;
    if (!timestamp) return;
    const tick = () => setWaitSeconds(Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [queue]);

  if (queue.length === 0) return null;

  return (
    <div data-session-mutation-handoff-placement="composer-above" className="px-3 pt-2" dir={dir}>
      <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-xl border border-aegis-border bg-aegis-surface">
        <div className="flex min-h-10 items-center gap-2 px-3">
          <GitBranch size={14} className="shrink-0 text-aegis-warning" />
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-[12px] font-medium text-aegis-text transition-colors hover:text-aegis-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
            aria-expanded={expanded}
            aria-label={t('chat.sessionMutationHandoffTitle')}
          >
            <span className="shrink-0">{t('chat.sessionMutationHandoffTitle')} · {queue.length}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-normal text-aegis-text-muted">
              {expanded
                ? (waitSeconds !== null ? t('chat.sessionMutationHandoffWait', { s: waitSeconds }) : '')
                : t('chat.sessionMutationHandoffDescription')}
            </span>
            {expanded
              ? <ChevronUp size={14} className="ms-auto shrink-0" />
              : <ChevronDown size={14} className="ms-auto shrink-0" />}
          </button>
          {confirmingClear ? (
            <>
              <span className="max-w-32 truncate text-[11px] text-aegis-text-muted">{t('chat.sessionMutationHandoffClearConfirm')}</span>
              <button
                type="button"
                onClick={() => { clearQueue(sessionKey); setConfirmingClear(false); setExpanded(false); }}
                className="grid size-6 place-items-center rounded-md text-aegis-danger transition-colors hover:bg-aegis-danger/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-danger/60"
                title={t('chat.sessionMutationHandoffClear')}
                aria-label={t('chat.sessionMutationHandoffClear')}
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="grid size-6 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                aria-label={t('chat.cancel')}
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="grid size-6 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-danger/60"
              title={t('chat.sessionMutationHandoffClear')}
              aria-label={t('chat.sessionMutationHandoffClear')}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {expanded && (
          <div className="max-h-[176px] overflow-y-auto border-t border-aegis-border scrollbar-hidden">
            {queue.map((item) => (
              <div key={item.id} className="flex items-start gap-2 border-b border-aegis-border/70 px-3 py-2 last:border-b-0">
                {editingId === item.id ? (
                  <div className="min-w-0 flex-1">
                    <textarea
                      autoFocus
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-md bg-[rgb(var(--aegis-overlay)/0.04)] p-2 text-[12px] text-aegis-text outline-none"
                    />
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const value = editingText.trim();
                          if (value) updateQueuedMessage(sessionKey, item.id, value);
                          setEditingId(null);
                          setEditingText('');
                        }}
                        className="grid size-6 place-items-center rounded-md border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary transition-colors hover:bg-aegis-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                        aria-label={t('chat.sessionMutationHandoffEdit')}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setEditingText(''); }}
                        className="grid size-6 place-items-center rounded-md text-aegis-text-muted transition-colors hover:text-aegis-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                        aria-label={t('chat.cancel')}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ) : deletingId === item.id ? (
                  <>
                    <span className="flex-1 text-[11px] text-aegis-text-muted">{t('chat.sessionMutationHandoffDeleteConfirm')}</span>
                    <button
                      type="button"
                      onClick={() => { removeQueuedMessage(sessionKey, item.id); setDeletingId(null); }}
                      className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-danger transition-colors hover:bg-aegis-danger/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-danger/60"
                      aria-label={t('chat.sessionMutationHandoffDelete')}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                      aria-label={t('chat.cancel')}
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 break-words text-[12px] text-aegis-text-secondary">
                      <span className="line-clamp-2">{item.text}</span>
                      {item.failed && (
                        <span className="mt-0.5 block line-clamp-1 text-[10px] text-aegis-danger">
                          {item.error || t('chat.sendError')}
                        </span>
                      )}
                    </span>
                    {item.failed && (
                      <button
                        type="button"
                        onClick={() => { void retryQueuedMessage(sessionKey, item.id); }}
                        className="grid size-5 shrink-0 place-items-center rounded-md text-aegis-danger transition-colors hover:bg-aegis-danger/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-danger/60"
                        title={t('chat.resend')}
                        aria-label={t('chat.resend')}
                      >
                        <RefreshCw size={11} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setEditingId(item.id); setEditingText(item.text); }}
                      className="grid size-5 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                      title={t('chat.sessionMutationHandoffEdit')}
                      aria-label={t('chat.sessionMutationHandoffEdit')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(item.id)}
                      className="grid size-5 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-danger/60"
                      title={t('chat.sessionMutationHandoffDelete')}
                      aria-label={t('chat.sessionMutationHandoffDelete')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
