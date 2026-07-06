// ═══════════════════════════════════════════════════════════
// ChatPage — Multi-session chat with tab bar
// ═══════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatTabs } from '@/components/Chat/ChatTabs';
import { ChatView } from '@/components/Chat/ChatView';
import { SessionContextBar } from '@/components/Chat/SessionContextBar';

/** Stable empty reference for `draftAttachments[k] ?? ...`. Inline `?? []`
 *  would allocate a fresh array each render and trip React #185 when the
 *  consumer wires the result into a useEffect dep. */
const EMPTY_ATTACH: string[] = [];
import { useAgentScopedSession } from '@/hooks/useAgentScopedSession';
import { useChatStore } from '@/stores/chatStore';

/** Inline attachment strip — shows paths dropped onto the pet (or attached
 *  manually) as chips above ChatView. Clicking the × removes one path;
 *  "Clear all" empties the draft. Files stay attached until the user sends
 *  a message or removes them — they aren't auto-sent on mount. */
function AttachmentBar() {
  const { t } = useTranslation();
  const activeKey = useChatStore((s) => s.activeSessionKey);
  // Stable empty reference — see MessageInput's EMPTY_PATHS for the React
// #185 rationale. Inline `?? []` allocates a fresh array per render.
const attachments = useChatStore((s) => s.draftAttachments[activeKey] ?? EMPTY_ATTACH);
  const removeOne = useChatStore((s) => s.removeDraftAttachment);
  const setDraft = useChatStore((s) => s.setDraftAttachments);
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-[rgb(var(--aegis-overlay)/0.06)] bg-aegis-bg-frosted-60">
      <Paperclip size={11} className="text-aegis-text-dim shrink-0" />
      <span className="text-[10.5px] text-aegis-text-dim shrink-0">
        {t('chat.attachments', '{{count}} 个附件', { count: attachments.length })}
      </span>
      <div className="flex flex-wrap items-center gap-1 ms-1 min-w-0">
        {attachments.map((p) => {
          const name = p.split(/[\\/]/).pop() || p;
          return (
            <span
              key={p}
              className="flex items-center gap-1 max-w-[260px] text-[10.5px] font-mono px-1.5 py-0.5 rounded-md bg-aegis-primary/10 text-aegis-primary"
              title={p}
            >
              <span className="truncate">{name}</span>
              <button
                onClick={() => removeOne(activeKey, p)}
                className="shrink-0 hover:text-aegis-text transition-colors"
                aria-label={t('chat.removeAttachment', 'Remove attachment')}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
      </div>
      <button
        onClick={() => setDraft(activeKey, [])}
        className="ms-auto text-[10.5px] text-aegis-text-dim hover:text-aegis-text transition-colors shrink-0"
      >
        {t('chat.clearAttachments', '清空')}
      </button>
    </div>
  );
}

export function ChatPage() {
  // Check for ?agent=<id>&new=1 and create a fresh per-agent session
  // before the first paint — the user sees their agent-scoped chat
  // instantly rather than landing on the main session first.
  useAgentScopedSession();

  // Listen for additional drops that arrive after ChatPage is mounted —
  // App.tsx sets pendingFiles + dispatches this event; we drain it into
  // the current session's draftAttachments. Single source of truth (the
  // event) — no useEffect-on-activeSessionKey loop, no risk of #185.
  useEffect(() => {
    const onDropped = (e: Event) => {
      const detail = (e as CustomEvent<{ paths: string[]; sessionKey: string }>).detail;
      const paths = detail?.paths ?? [];
      if (paths.length === 0) return;
      const key = detail?.sessionKey ?? useChatStore.getState().activeSessionKey;
      // Use the event's sessionKey (App.tsx stamps it on the new session)
      // so a drop while sitting on a different tab lands in the freshly-
      // created session rather than the current view.
      useChatStore.getState().setDraftAttachments(key, paths);
      useChatStore.getState().setPendingFiles([]);
    };
    window.addEventListener('aegis:files-dropped', onDropped);
    return () => window.removeEventListener('aegis:files-dropped', onDropped);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <SessionContextBar />
      <ChatTabs />
      <AttachmentBar />
      <ChatView />
    </div>
  );
}
