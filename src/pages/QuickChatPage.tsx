/**
 * QuickChatPage — compact single-session chat surface.
 *
 * Hosted in its own Tauri WebviewWindow ("quickchat" label). No sidebar,
 * no workbench — just one focused conversation with the dropped file(s)
 * attached as context.
 *
 * Lifecycle:
 *  - On mount: listen for `quickchat:seed` (Rust emits the dropped paths
 *    after a 450ms warm-up so React is ready).
 *  - On unmount / close: dedupe the auto-created session via the chat
 *    store's sessionCleanup helper (TBD), or just leave the session
 *    around so the user can re-open the same QuickChat and pick up.
 *
 * Window itself is frameless + transparent + always_on_top (see Rust
 * quickchat.rs builder), so we render our own draggable title bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, FileText, Folder, Sparkles, Minus, Maximize2, GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { gateway } from '@/services/gateway';
import { useTranslation } from 'react-i18next';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

interface SeedFile {
  path: string;
  name: string;
  isDir: boolean;
}

function parseName(p: string): SeedFile {
  // Strip file:// prefix that some OSes tack on, also handle URLs.
  let path = p;
  if (path.startsWith('file://')) path = path.slice(7);
  // On Windows file:///C:/..., strip extra /
  if (path.startsWith('file:')) path = path.slice(5);
  const cleaned = path.split('/').pop() || path;
  // Heuristic: dir = no dot in last segment (most files have ext)
  const isDir = !cleaned.includes('.');
  return { path, name: cleaned, isDir };
}

export function QuickChatPage() {
  const { t } = useTranslation();
  const connected = useChatStore((state) => state.connected);
  const connecting = useChatStore((state) => state.connecting);
  const connectionError = useChatStore((state) => state.connectionError);
  const [files, setFiles] = useState<SeedFile[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [streamedReply, setStreamedReply] = useState('');
  const [sessionKey, setSessionKey] = useState<string | null>(null);

  // Read the latest streamed assistant message for this session from the
  // shared chat store. This keeps quickchat in sync with whatever the
  // gateway streams without us re-implementing the stream pipeline.
  const messages = useChatStore((s) =>
    sessionKey ? s.messagesPerSession[sessionKey] ?? [] : []
  );
  const lastAssistant = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && typeof messages[i].content === 'string') {
        return messages[i].content as string;
      }
    }
    return '';
  })();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Subscribe to the seed event from Rust. The webview window we live in
  // has its own event bus, separate from the main window — that's exactly
  // what we want, so per-window fresh sessions don't pollute the main
  // store's seed key.
  const applySeed = useCallback((paths: string[]) => {
    const parsed = paths.map(parseName);
    setFiles(parsed);
    setText((current) => {
      if (current) return current;
      const dirCount = parsed.filter(file => file.isDir).length;
      const fileCount = parsed.length - dirCount;
      if (parsed.length === 1) {
        return t('pet.quickChat.defaultQuestionSingle', { name: parsed[0].name });
      }
      return t('pet.quickChat.defaultQuestionMany', {
        count: parsed.length,
        detail: dirCount > 0 && fileCount > 0
          ? t('pet.quickChat.mixedResources', { dirCount, fileCount })
          : '',
      });
    });
    inputRef.current?.focus();
  }, [t]);

  useEffect(() => {
    let disposed = false;
    const unlisten = subscribeTauriEvent<string[]>('quickchat:seed', (e) => {
      if (!disposed) applySeed(e.payload);
    });
    void invoke<string[]>('get_quickchat_seed')
      .then((initial) => {
        if (!disposed && initial.length > 0) applySeed(initial);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten();
    };
  }, [applySeed]);

  // Drag-region for the frameless title bar.
  const titleDragRegion = 'data-tauri-drag-region';

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);

    // Build a context-rich initial message: attachment list + the user text.
    const attachmentLines = files.map(f => `- ${f.isDir ? 'DIR' : 'FILE'} ${f.name} (${f.path})`).join('\n');
    const fullMessage = `${t('pet.quickChat.attachmentIntro')}\n${attachmentLines}\n\n${trimmed}`;

    // Resolve or create a dedicated session for this quick chat window.
    const key = sessionKey ?? (() => {
      const k = `quickchat:${Date.now()}`;
      setSessionKey(k);
      return k;
    })();

    try {
      // Use chatStore to push the user message into the merged sessions list
      // so the main window will see this conversation too. We piggy-back on
      // the existing message lifecycle but flag this session for later cleanup.
      useChatStore.getState().addMessage({
        id: `qc-${Date.now()}`,
        role: 'user',
        content: fullMessage,
        timestamp: new Date().toISOString(),
      }, key);

      // Stream reply inline — we read the assistant message that the
      // chat store fills as tokens arrive. Set sending state and the
      // store will update lastAssistant on every chunk.
      try {
        await gateway.sendMessage(fullMessage, undefined, key);
      } catch (err: any) {
        setStreamedReply(t('pet.quickChat.sendError', { error: err?.message ?? String(err) }));
      }

      setText('');
    } finally {
      setSending(false);
      setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }), 30);
    }
  }, [text, sending, files, sessionKey, t]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleClose = useCallback(async () => {
    try { await invoke('close_quickchat'); } catch {}
  }, []);

  return (
    <div className="flex flex-col h-screen bg-black/40 backdrop-blur-xl text-aegis-text select-none">
      {/* Title bar — frameless so we draw our own drag region */}
      <div {...{ [titleDragRegion]: '' }} className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/20">
        <GripVertical size={12} className="opacity-40" />
        <Sparkles size={12} className="text-aegis-primary" />
        <span className="text-[12px] font-semibold tracking-wide">JunQi Quick Chat</span>
        <span className="text-[10px] text-aegis-text-dim ml-1">
          {files.length > 0 ? `· ${t('pet.quickChat.itemCount', { count: files.length })}` : ''}
        </span>
        <span
          className={clsx(
            'ml-1 h-1.5 w-1.5 rounded-full',
            connected ? 'bg-emerald-400' : connecting ? 'bg-amber-400 animate-pulse' : 'bg-red-400',
          )}
          title={connected
            ? t('connection.connected')
            : connecting
              ? t('gateway.connectingLabel')
              : connectionError || t('gateway.disconnectedLabel')}
        />
        <div className="ml-auto flex items-center gap-0.5" {...{ 'data-tauri-drag-region': false } as any}>
          <button
            onClick={handleClose}
            className="w-6 h-6 rounded flex items-center justify-center text-aegis-text-dim hover:text-aegis-text hover:bg-white/10 transition-colors"
            title={t('pet.quickChat.close')}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Attachment chips */}
      {files.length > 0 && (
        <div className="px-3 py-2 border-b border-white/5 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] border border-white/10 text-[11px]"
              title={f.path}
            >
              {f.isDir
                ? <Folder size={11} className="text-aegis-warning" />
                : <FileText size={11} className="text-aegis-primary" />}
              <span className="max-w-[180px] truncate">{f.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Streamed reply area — reads from chatStore so it stays in sync
          with the main app's view of the same session. */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {!lastAssistant && files.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-aegis-text-dim gap-1.5">
            <Sparkles size={24} className="opacity-30" />
            <div className="text-[12px]">{t('pet.quickChat.emptyTitle')}</div>
            <div className="text-[11px] opacity-70">{t('pet.quickChat.emptyHint')}</div>
          </div>
        )}
        {(lastAssistant || streamedReply) && (
          <div className="whitespace-pre-wrap break-words animate-in fade-in slide-in-from-bottom-2 duration-200">
            {streamedReply || lastAssistant}
            {sending && <span className="inline-block w-1.5 h-3.5 bg-aegis-primary ml-0.5 align-middle animate-pulse" />}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-white/10 p-2.5 bg-black/30">
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          placeholder={files.length ? t('pet.quickChat.questionPlaceholder') : t('pet.quickChat.dropPlaceholder')}
          className={clsx(
            'w-full bg-black/30 border border-white/15 rounded-md px-2.5 py-2 text-[13px] resize-none outline-none',
            'focus:border-aegis-primary/50 transition-colors placeholder:text-aegis-text-dim/60'
          )}
        />
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <div className="text-[10px] text-aegis-text-dim opacity-60">
            {text.length > 0 && t('pet.quickChat.characterCount', { count: text.length })}
          </div>
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className={clsx(
              'px-3 py-1 rounded-md text-[11px] font-semibold transition-all',
              sending || !text.trim()
                ? 'bg-white/10 text-aegis-text-dim cursor-not-allowed'
                : 'bg-aegis-primary text-white hover:brightness-110'
            )}
          >
            {sending ? t('pet.quickChat.sending') : t('pet.quickChat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Avoid unused import warning on Maximize/Minus for future use
void Maximize2;
void Minus;
