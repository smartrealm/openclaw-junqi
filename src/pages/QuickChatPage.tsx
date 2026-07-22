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
 *  - On unmount / close: release this WebView's client lease and voice output.
 *    Gateway retains conversation history, but the session is never persisted
 *    as an open main-window tab.
 *
 * Window itself is frameless + transparent + always_on_top (see Rust
 * quickchat.rs builder), so we render our own draggable title bar.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, FileText, Folder, Sparkles, GripVertical, Square } from 'lucide-react';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { useVoiceStore } from '@/stores/voiceStore';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import {
  createPreparedAttachment,
  displayAttachments,
  toGatewayAttachments,
} from '@/services/chat/attachments';
import { useTranslation } from 'react-i18next';
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import { projectResponseGroupChrome } from '@/processing/buildResponseGroups';
import { projectResponseGroupToRenderBlocks } from '@/processing/projectResponseGroup';
import { groupExecutionProcessBlocks } from '@/components/Chat/executionProcessGrouping';
import { ExecutionProcessGroup } from '@/components/Chat/ExecutionProcessGroup';
import type { MessageBlock, RenderBlock } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { projectQuickChatResponseGroups } from './quickChatProjection';

interface SeedFile {
  path: string;
  name: string;
  isDir: boolean;
}

const EMPTY_MESSAGES: ReturnType<typeof useChatStore.getState>['messages'] = [];
const EMPTY_QUEUE: ReturnType<typeof useChatStore.getState>['messageQueue'][string] = [];
const EMPTY_RESPONSE_GROUPS: ResponseGroup[] = [];

const AssistantResponseAvatar = lazy(() => import('@/components/Chat/MessageBubble').then((module) => ({ default: module.AssistantResponseAvatar })));
const AssistantResponseFooter = lazy(() => import('@/components/Chat/MessageBubble').then((module) => ({ default: module.AssistantResponseFooter })));
const MessageBubble = lazy(() => import('@/components/Chat/MessageBubble').then((module) => ({ default: module.MessageBubble })));
const InlineButtonBar = lazy(() => import('@/components/Chat/InlineButtonBar').then((module) => ({ default: module.InlineButtonBar })));
const ThinkingBubble = lazy(() => import('@/components/Chat/ThinkingBubble').then((module) => ({ default: module.ThinkingBubble })));
const ToolCallBubble = lazy(() => import('@/components/Chat/ToolCallBubble').then((module) => ({ default: module.ToolCallBubble })));
const DecisionCard = lazy(() => import('@/components/Chat/ResultCards').then((module) => ({ default: module.DecisionCard })));
const FileResultCard = lazy(() => import('@/components/Chat/ResultCards').then((module) => ({ default: module.FileResultCard })));
const SessionEventCard = lazy(() => import('@/components/Chat/ResultCards').then((module) => ({ default: module.SessionEventCard })));
const WorkshopEventCard = lazy(() => import('@/components/Chat/ResultCards').then((module) => ({ default: module.WorkshopEventCard })));

function normalizeDroppedPath(input: string): string {
  if (!input.startsWith('file:')) return input;
  try {
    const decoded = decodeURIComponent(new URL(input).pathname);
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return input.replace(/^file:\/\/+/, '');
  }
}

async function inspectSeedFile(input: string): Promise<SeedFile> {
  const path = normalizeDroppedPath(input);
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  const { stat } = await import('@tauri-apps/plugin-fs');
  const metadata = await stat(path);
  return { path, name, isDir: metadata.isDirectory };
}

export function QuickChatPage({ sessionKey: ownedSessionKey }: { sessionKey?: string } = {}) {
  const { t } = useTranslation();
  const connected = useChatStore((state) => state.connected);
  const connecting = useChatStore((state) => state.connecting);
  const connectionError = useChatStore((state) => state.connectionError);
  const [files, setFiles] = useState<SeedFile[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [fallbackSessionKey] = useState(() => `quickchat:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
  const sessionKey = ownedSessionKey || fallbackSessionKey;
  const isTyping = useChatStore((state) => Boolean(state.typingBySession[sessionKey]));
  const queue = useChatStore((state) => state.messageQueue[sessionKey] ?? EMPTY_QUEUE);
  const queueCount = queue.length;
  const failedQueuedMessage = queue.find((message) => message.failed);
  const voiceOutputActive = useVoiceStore((state) =>
    state.remoteOutput !== null
      || ((state.phase === 'queued' || state.phase === 'speaking') && state.sessionKey === sessionKey),
  );

  // Gateway-normalized response groups are the single projection authority in
  // both the main chat and QuickChat. The compact window must not reconstruct
  // tool/file/decision state from plain assistant text.
  const messages = useChatStore((s) =>
    sessionKey ? s.messagesPerSession[sessionKey] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );
  const responseGroups = useChatStore((state) => state._groupsCache[sessionKey] ?? EMPTY_RESPONSE_GROUPS);
  const quickChatResponseGroups = useMemo(
    () => projectQuickChatResponseGroups(responseGroups),
    [responseGroups],
  );
  const typingStartedAt = useChatStore((state) => state.typingStartedAtBySession[sessionKey]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Subscribe to the seed event from Rust. The webview window we live in
  // has its own event bus, separate from the main window — that's exactly
  // what we want, so per-window fresh sessions don't pollute the main
  // store's seed key.
  const applySeed = useCallback(async (paths: string[]) => {
    const inspected = await Promise.allSettled(paths.map(inspectSeedFile));
    const parsed = inspected.flatMap((result) => (
      result.status === 'fulfilled' ? [result.value] : []
    ));
    if (parsed.length === 0 && paths.length > 0) {
      setSendError(t('pet.quickChat.resourceReadFailed'));
      return;
    }
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
      if (!disposed) void applySeed(e.payload);
    });
    void invoke<string[]>('get_quickchat_seed')
      .then((initial) => {
        if (!disposed && initial.length > 0) void applySeed(initial);
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
    if (!trimmed || sending || !connected) return;
    voiceRuntime.interruptGlobally(sessionKey);
    setSending(true);
    setSendError('');

    const directoryLines = files
      .filter((file) => file.isDir)
      .map((file) => `- DIR ${file.name} (${file.path})`)
      .join('\n');
    const fullMessage = directoryLines
      ? `${t('pet.quickChat.attachmentIntro')}\n${directoryLines}\n\n${trimmed}`
      : trimmed;

    // The session is created at mount so Gateway callbacks can be scoped before
    // the first request is sent.
    const key = sessionKey;

    try {
      const clientMessageId = createClientMessageId();
      const prepared = await Promise.all(files.filter((file) => !file.isDir).map(async (seed) => {
        const file = await window.aegis?.file?.read(seed.path);
        if (!file) throw new Error(`Unable to read ${seed.name}`);
        return createPreparedAttachment({
          fileName: file.name,
          mimeType: file.mimeType,
          base64: file.base64,
          size: file.size,
          preview: file.isImage ? `data:${file.mimeType};base64,${file.base64}` : undefined,
          sourcePath: seed.path,
        });
      }));
      const attachments = toGatewayAttachments(prepared);
      await chatSendCoordinator.send({
        sessionKey: key,
        message: fullMessage,
        clientMessageId,
        attachments: attachments.length ? attachments : undefined,
        displayAttachments: displayAttachments(prepared),
      });
      setText('');
      setFiles([]);
    } catch (err: any) {
      setSendError(t('pet.quickChat.sendError', { error: err?.message ?? String(err) }));
    } finally {
      setSending(false);
      setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }), 30);
    }
  }, [text, sending, connected, files, sessionKey, t]);

  const handleRetryQueuedMessage = useCallback(async () => {
    if (!failedQueuedMessage) return;
    setSendError('');
    await useChatStore.getState().retryQueuedMessage(sessionKey, failedQueuedMessage.id);
  }, [failedQueuedMessage, sessionKey]);

  const handleStop = useCallback(async () => {
    voiceRuntime.interruptGlobally(sessionKey);
    useChatStore.getState().clearQueue(sessionKey);
    if (!useChatStore.getState().typingBySession[sessionKey]) return;
    try {
      await gateway.abortChat(sessionKey);
    } catch (error) {
      setSendError(t('pet.quickChat.sendError', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [sessionKey, t]);

  const handleStructuredChoice = useCallback(async (value: string) => {
    const message = value.trim();
    if (!message || sending || !connected) return;
    voiceRuntime.interruptGlobally(sessionKey);
    setSending(true);
    setSendError('');
    try {
      await chatSendCoordinator.send({
        sessionKey,
        message,
        clientMessageId: createClientMessageId(),
      });
    } catch (error) {
      setSendError(t('pet.quickChat.sendError', {
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setSending(false);
    }
  }, [connected, sending, sessionKey, t]);

  const renderQuickChatBlock = useCallback((block: RenderBlock) => {
    switch (block.type) {
      case 'message':
        return (
          <Suspense fallback={<div className="ml-[46px] min-h-8 animate-pulse rounded-lg bg-white/[0.04]" />}>
            <MessageBubble block={block} sessionKey={sessionKey} groupPosition="middle" />
          </Suspense>
        );
      case 'tool':
        return (
          <Suspense fallback={<div className="ml-[46px] h-7 animate-pulse rounded bg-white/[0.04]" />}>
            <ToolCallBubble tool={{
              toolName: block.toolName,
              input: block.input,
              output: block.output,
              status: block.status,
              durationMs: block.durationMs,
            }} />
          </Suspense>
        );
      case 'thinking':
        return (
          <Suspense fallback={<div className="ml-[46px] h-7 animate-pulse rounded bg-white/[0.04]" />}>
            <ThinkingBubble content={block.content} isStreaming={block.isStreaming} />
          </Suspense>
        );
      case 'file-output':
        return <Suspense fallback={null}><FileResultCard files={block.files} /></Suspense>;
      case 'decision':
        return (
          <Suspense fallback={null}>
            <DecisionCard options={block.options} onSelect={(value) => { void handleStructuredChoice(value); }} />
          </Suspense>
        );
      case 'workshop-event':
        return <Suspense fallback={null}><WorkshopEventCard events={block.events} /></Suspense>;
      case 'session-event':
        return <Suspense fallback={null}><SessionEventCard event={block.event} /></Suspense>;
      case 'inline-buttons':
        return (
          <Suspense fallback={null}>
            <InlineButtonBar
              buttons={block.rows.map((row) => row.buttons)}
              onCallback={(value) => { void handleStructuredChoice(value); }}
            />
          </Suspense>
        );
      case 'compaction':
        return null;
      default:
        return null;
    }
  }, [handleStructuredChoice, sessionKey]);

  const renderQuickChatGroup = useCallback((group: ResponseGroup, appendTyping: boolean) => {
    const blocks = projectResponseGroupToRenderBlocks(group);
    const rows = groupExecutionProcessBlocks(blocks);
    const chrome = projectResponseGroupChrome(group);
    const representative = chrome.owner === 'group' && chrome.representativeMessageId
      ? blocks.find((block): block is MessageBlock => (
          block.type === 'message' && block.id === chrome.representativeMessageId
        )) ?? null
      : null;
    const footerTimestamp = representative?.timestamp
      ?? group.blocks[group.blocks.length - 1]?.timestamp
      ?? group.timestamp;
    const hasStreamingText = blocks.some((block) => (
      block.type === 'message' && block.isStreaming && block.markdown.trim().length > 0
    ));

    return (
      <section key={group.id} className="relative space-y-2 py-1" data-quickchat-response-group={group.id}>
        {chrome.owner === 'group' && (
          <Suspense fallback={<div className="absolute left-1 top-1 h-8 w-8 animate-pulse rounded-full bg-aegis-primary/15" />}>
            <AssistantResponseAvatar sessionKey={group.sessionKey} className="absolute left-1 top-1 z-[1]" />
          </Suspense>
        )}
        {rows.map((row, index) => row.type === 'execution' ? (
          <ExecutionProcessGroup
            key={`execution-${row.blocks[0]?.id ?? index}`}
            blocks={row.blocks}
            streaming={group.status === 'streaming'}
            renderBlock={renderQuickChatBlock}
          />
        ) : (
          <div key={row.block.id}>{renderQuickChatBlock(row.block)}</div>
        ))}
        {appendTyping && !hasStreamingText && (
          <div className="ml-[46px] inline-flex items-center gap-1.5 rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.06] px-2.5 py-2" aria-label={t('chat.assistantPreparing', 'Assistant is preparing a response')}>
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1.5 w-1.5 rounded-full bg-aegis-primary animate-pulse"
                style={{ animationDelay: `${index * 140}ms` }}
              />
            ))}
          </div>
        )}
        {chrome.owner === 'group' && (
          <Suspense fallback={<div className="ml-[46px] h-4 w-28 animate-pulse rounded bg-white/[0.04]" />}>
            <AssistantResponseFooter
              sessionKey={group.sessionKey}
              block={representative}
              timestamp={footerTimestamp}
              status={group.status}
              className="ml-[46px] mr-2"
            />
          </Suspense>
        )}
      </section>
    );
  }, [renderQuickChatBlock, t]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleClose = useCallback(async () => {
    if (useChatStore.getState().typingBySession[sessionKey]) {
      await handleStop().catch(() => undefined);
    } else {
      useChatStore.getState().clearQueue(sessionKey);
    }
    try { await invoke('close_quickchat'); } catch {}
  }, [handleStop, sessionKey]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [quickChatResponseGroups, isTyping]);

  const lastQuickChatGroupIndex = quickChatResponseGroups.length - 1;
  const typingOwnerGroupIndex = quickChatResponseGroups[lastQuickChatGroupIndex]?.role === 'assistant'
    ? lastQuickChatGroupIndex
    : -1;

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

      {/* Uses the same normalized response groups as the main chat. */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {quickChatResponseGroups.length === 0 && !isTyping && messages.length === 0 && files.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-aegis-text-dim gap-1.5">
            <Sparkles size={24} className="opacity-30" />
            <div className="text-[12px]">{t('pet.quickChat.emptyTitle')}</div>
            <div className="text-[11px] opacity-70">{t('pet.quickChat.emptyHint')}</div>
          </div>
        )}
        {quickChatResponseGroups.map((group, index) => (
          renderQuickChatGroup(group, isTyping && index === typingOwnerGroupIndex)
        ))}
        {isTyping && typingOwnerGroupIndex < 0 && (
          <section className="relative space-y-2 py-1" data-quickchat-response-group="typing">
            <Suspense fallback={<div className="absolute left-1 top-1 h-8 w-8 animate-pulse rounded-full bg-aegis-primary/15" />}>
              <AssistantResponseAvatar sessionKey={sessionKey} className="absolute left-1 top-1" />
            </Suspense>
            <div className="ml-[46px] inline-flex items-center gap-1.5 rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.06] px-2.5 py-2" aria-label={t('chat.assistantPreparing', 'Assistant is preparing a response')}>
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 rounded-full bg-aegis-primary animate-pulse"
                  style={{ animationDelay: `${index * 140}ms` }}
                />
              ))}
            </div>
            <Suspense fallback={null}>
              <AssistantResponseFooter
                sessionKey={sessionKey}
                timestamp={new Date(typingStartedAt ?? Date.now()).toISOString()}
                status="streaming"
                className="ml-[46px] mr-2"
              />
            </Suspense>
          </section>
        )}
        {sendError && <div className="mt-2 text-[11px] text-aegis-danger">{sendError}</div>}
        {failedQueuedMessage && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-aegis-danger">
            <span className="min-w-0 flex-1 truncate" title={failedQueuedMessage.error}>
              {failedQueuedMessage.error || t('chat.sendFailed')}
            </span>
            <button
              type="button"
              onClick={() => { void handleRetryQueuedMessage(); }}
              className="shrink-0 rounded-md border border-aegis-danger/30 px-2 py-1 font-medium hover:bg-aegis-danger/10"
            >
              {t('common.retry')}
            </button>
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
            {queueCount > 0
              ? t('chat.queueMore', { n: queueCount })
              : text.length > 0 && t('pet.quickChat.characterCount', { count: text.length })}
          </div>
          <div className="flex items-center gap-1.5">
            {(isTyping || voiceOutputActive) && (
              <button
                onClick={() => { void handleStop(); }}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-aegis-danger/80 text-white transition-colors hover:bg-aegis-danger"
                title={t('chat.stopped')}
              >
                <Square size={11} fill="currentColor" />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={sending || !connected || !text.trim()}
              className={clsx(
                'px-3 py-1 rounded-md text-[11px] font-semibold transition-all',
                sending || !connected || !text.trim()
                  ? 'bg-white/10 text-aegis-text-dim cursor-not-allowed'
                  : 'bg-aegis-primary text-white hover:brightness-110'
              )}
            >
              {sending
                ? t('pet.quickChat.sending')
                : isTyping
                  ? t('input.queue', 'Queue')
                  : t('pet.quickChat.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
