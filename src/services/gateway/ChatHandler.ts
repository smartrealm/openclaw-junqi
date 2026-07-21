// ═══════════════════════════════════════════════════════════
// ChatHandler — Chat Event Processing Layer
// Handles all chat stream events received from the Gateway.
// Depends on GatewayConnection for transport and callbacks.
// No WebSocket logic here — pure chat / UI state management.
// ═══════════════════════════════════════════════════════════

import { extractText, stripDirectives } from '@/processing/TextCleaner';
import { extractThinkingContent } from '@/processing/normalizeGatewayMessage';
import { handleGatewayEvent } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { parseButtons } from '@/utils/buttonParser';
import { debugLog, debugWarn } from '@/utils/debugLog';
import { isIsolatedExecutionSessionKey } from '@/utils/sessionPresentation';
import i18n from '@/i18n';
import {
  GatewayConnection,
  type MediaInfo,
} from './Connection';
import {
  OpenClawChatRunProjection,
  type OpenClawRunLease,
  type OpenClawSessionRunReconciliation,
} from './OpenClawChatRunProjection';

// ── Workshop Command Parser ──
// Parses [[workshop:action ...]] commands from agent messages
interface WorkshopCommandResult {
  cleanContent: string;
  blockedCount: number;
}

function sanitizeWorkshopCommands(content: string): WorkshopCommandResult {
  if (!content.includes('[[workshop:')) {
    return { cleanContent: content.trim(), blockedCount: 0 };
  }

  let blockedCount = 0;
  const commandRegex = /\[\[workshop:(\w+)((?:\s+\w+="[^"]*")*)\]\]/g;
  const cleanContent = content.replace(commandRegex, () => {
    blockedCount += 1;
    return '';
  });

  return { cleanContent: cleanContent.trim(), blockedCount };
}

// ═══════════════════════════════════════════════════════════
// ChatHandler Class
// ═══════════════════════════════════════════════════════════

export class ChatHandler {
  // ── Streaming state ──
  private readonly runProjection = new OpenClawChatRunProjection();
  private currentRunIdBySession = new Map<string, string>();
  private currentStreamContentBySession = new Map<string, string>();
  private currentMessageIdBySession = new Map<string, string>();
  private syntheticMessageCounterBySession = new Map<string, number>();
  private streamConsumedBySession = new Map<string, number>();
  private textStreamSourceBySession = new Map<string, 'chat' | 'agent'>();
  private lastCompactionTs: number = 0;

  // ── Stream micro-batching ──
  // Buffer WebSocket chunks and flush to React every STREAM_FLUSH_MS
  // to reduce re-renders from every event to ~20 FPS max
  private static readonly STREAM_FLUSH_MS = 50;
  private static readonly MAX_RUN_SESSION_BINDINGS = 512;
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStreams = new Map<string, { id: string; content: string; media?: MediaInfo; runId?: string | null }>();
  private sessionKeyByRunId = new Map<string, string>();
  private finalizeFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private transcriptRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private conn: GatewayConnection) {}

  /** Drop a locally invalidated run after a confirmed reset or deletion. */
  invalidateSession(sessionKey: string): void {
    this.runProjection.invalidate(sessionKey);
    this.clearSessionProjection(sessionKey);
  }

  /** A closed socket cannot deliver its old frames, but its run may continue remotely. */
  clearTransportProjection(): void {
    for (const sessionKey of this.runProjection.activeSessionKeys()) {
      const active = this.runProjection.active(sessionKey);
      this.clearSessionProjection(sessionKey);
      if (active) this.bindRunToSession(sessionKey, active.runId);
    }
  }

  /**
   * Reconcile locally pending UI sessions against OpenClaw's authoritative
   * sessions.list run state after a successful socket connection.
   */
  reconcileSessionRuns(sessions: unknown[]): void {
    const pendingSessions = new Set([
      ...this.runProjection.activeSessionKeys(),
      ...Object.entries(useChatStore.getState().typingBySession)
        .filter(([, typing]) => typing)
        .map(([sessionKey]) => sessionKey),
    ]);
    this.applySessionRunReconciliations(
      this.runProjection.reconcileSessionSnapshots(sessions, pendingSessions),
    );
  }

  /** Observe runs discovered by a normal sessions refresh without settling local work. */
  observeActiveSessionRuns(sessions: unknown[]): void {
    this.applySessionRunReconciliations(this.runProjection.observeActiveSessionSnapshots(sessions));
  }

  private applySessionRunReconciliations(
    resolutions: OpenClawSessionRunReconciliation[],
  ): void {
    for (const resolution of resolutions) {
      if (resolution.state === 'settled') {
        this.clearSessionProjection(resolution.sessionKey);
      } else {
        if (resolution.replacedRunId) {
          this.closeCurrentStreamSegment(resolution.sessionKey, undefined, resolution.replacedRunId);
          this.clearActiveResponse(resolution.sessionKey, resolution.replacedRunId);
        }
        if (resolution.activeRunId) this.bindRunToSession(resolution.sessionKey, resolution.activeRunId);
      }
      this.conn.callbacks?.onSessionRunReconciliation?.(resolution);
    }
  }

  private bindRunToSession(sessionKey: string, runId?: unknown) {
    const normalizedSessionKey = sessionKey.trim();
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
    if (normalizedSessionKey && normalizedRunId) {
      this.sessionKeyByRunId.delete(normalizedRunId);
      this.sessionKeyByRunId.set(normalizedRunId, normalizedSessionKey);
      while (this.sessionKeyByRunId.size > ChatHandler.MAX_RUN_SESSION_BINDINGS) {
        const oldestRunId = this.sessionKeyByRunId.keys().next().value;
        if (oldestRunId === undefined) break;
        this.sessionKeyByRunId.delete(oldestRunId);
      }
    }
  }

  private resolveSessionKey(sessionKey?: unknown, runId?: unknown): string | null {
    const normalizedSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
    if (normalizedSessionKey) {
      this.bindRunToSession(normalizedSessionKey, runId);
      return normalizedSessionKey;
    }
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
    if (normalizedRunId) {
      return this.sessionKeyByRunId.get(normalizedRunId) || null;
    }
    return null;
  }

  /** Flush buffered stream content to the UI */
  private flushStream(sessionKey?: string) {
    const entries = sessionKey
      ? (this.pendingStreams.has(sessionKey) ? [[sessionKey, this.pendingStreams.get(sessionKey)!] as const] : [])
      : Array.from(this.pendingStreams.entries());

    for (const [key, pending] of entries) {
      if (!pending.content) continue;
      this.conn.callbacks?.onStreamChunk(
        key,
        pending.id,
        pending.content,
        pending.media,
        pending.runId,
      );
      this.pendingStreams.delete(key);
    }
    if (!sessionKey || this.pendingStreams.size === 0) {
      this.streamFlushTimer = null;
    }
  }

  /** Buffer a stream chunk — actual UI update happens at most every STREAM_FLUSH_MS */
  private bufferStreamChunk(sessionKey: string, id: string, content: string, media?: MediaInfo, runId?: string | null) {
    this.pendingStreams.set(sessionKey, { id, content, media, runId });

    if (!this.streamFlushTimer) {
      this.streamFlushTimer = setTimeout(() => this.flushStream(), ChatHandler.STREAM_FLUSH_MS);
    }
  }

  /** Force-flush any pending stream content (called before final/error/abort) */
  private forceFlushStream(sessionKey?: string) {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    this.flushStream(sessionKey);
  }

  private clearFinalizeFallback(sessionKey: string) {
    const timer = this.finalizeFallbackTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      this.finalizeFallbackTimers.delete(sessionKey);
    }
  }

  private clearTranscriptRefresh(sessionKey: string): void {
    const timer = this.transcriptRefreshTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      this.transcriptRefreshTimers.delete(sessionKey);
    }
  }

  private scheduleTranscriptRefresh(sessionKey: string): void {
    if (this.transcriptRefreshTimers.has(sessionKey)) return;
    const timer = setTimeout(() => {
      this.transcriptRefreshTimers.delete(sessionKey);
      this.conn.callbacks?.onTranscriptChanged?.(sessionKey);
    }, 75);
    this.transcriptRefreshTimers.set(sessionKey, timer);
  }

  private getDisplayStreamText(text: string): string {
    let cleaned = stripDirectives(text);
    cleaned = cleaned.replace(/\[\[workshop:\w+(?:\s+\w+="[^"]*")*\]\]/g, '');
    cleaned = cleaned.replace(/\[\[button:[^\]]+\]\]/g, '');
    return cleaned;
  }

  private getPayloadMessageId(payload: any): string {
    const candidateIds = [
      payload?.messageId,
      payload?.message?.id,
      payload?.message?.messageId,
      payload?.data?.messageId,
    ];
    return candidateIds.find((value): value is string => typeof value === 'string' && value.trim().length > 0) || '';
  }

  private createSyntheticMessageId(sessionKey: string, runId: string): string {
    const nextSeq = (this.syntheticMessageCounterBySession.get(sessionKey) || 0) + 1;
    this.syntheticMessageCounterBySession.set(sessionKey, nextSeq);
    return `live:${sessionKey}:${runId || 'runless'}:${nextSeq}`;
  }

  private ensureActiveMessageId(sessionKey: string, runId: string, payload?: any): string {
    const activeRunId = this.currentRunIdBySession.get(sessionKey);
    const activeMessageId = this.currentMessageIdBySession.get(sessionKey);
    const payloadMessageId = this.getPayloadMessageId(payload);

    if (activeRunId === runId && activeMessageId) {
      return activeMessageId;
    }

    const messageId = payloadMessageId || this.createSyntheticMessageId(sessionKey, runId);
    this.currentMessageIdBySession.set(sessionKey, messageId);
    return messageId;
  }

  private getSegmentText(sessionKey: string, rawContent: string): string {
    const consumed = this.streamConsumedBySession.get(sessionKey) || 0;
    return consumed > 0 && rawContent.length > consumed
      ? rawContent.slice(consumed)
      : rawContent;
  }

  private clearSessionProjection(sessionKey: string): void {
    this.clearFinalizeFallback(sessionKey);
    this.clearTranscriptRefresh(sessionKey);
    const pending = this.pendingStreams.get(sessionKey);
    if (pending) this.pendingStreams.delete(sessionKey);
    this.clearActiveResponse(sessionKey);
    for (const [runId, ownerSessionKey] of this.sessionKeyByRunId) {
      if (ownerSessionKey === sessionKey) this.sessionKeyByRunId.delete(runId);
    }
  }

  private clearActiveResponse(sessionKey: string, expectedRunId?: string): boolean {
    const runId = this.currentRunIdBySession.get(sessionKey);
    if (expectedRunId && runId && runId !== expectedRunId) return false;
    if (runId) this.sessionKeyByRunId.delete(runId);
    this.currentStreamContentBySession.delete(sessionKey);
    this.currentRunIdBySession.delete(sessionKey);
    this.currentMessageIdBySession.delete(sessionKey);
    this.streamConsumedBySession.delete(sessionKey);
    this.textStreamSourceBySession.delete(sessionKey);
    const pending = this.pendingStreams.get(sessionKey);
    if (!expectedRunId || !pending?.runId || pending.runId === expectedRunId) {
      this.pendingStreams.delete(sessionKey);
    }
    return true;
  }

  private closeCurrentStreamSegment(sessionKey: string, media?: MediaInfo, expectedRunId?: string): boolean {
    const activeRunId = this.currentRunIdBySession.get(sessionKey);
    if (expectedRunId && activeRunId && activeRunId !== expectedRunId) return false;
    this.clearFinalizeFallback(sessionKey);
    this.forceFlushStream(sessionKey);
    const messageId = this.currentMessageIdBySession.get(sessionKey);
    const content = this.currentStreamContentBySession.get(sessionKey) || '';
    const segmentText = this.getSegmentText(sessionKey, content);
    if (messageId && segmentText.trim()) {
      const runId = this.currentRunIdBySession.get(sessionKey) || null;
      useChatStore.getState().finalizeStreamingMessage(
        messageId,
        this.getDisplayStreamText(segmentText),
        {
          ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
          ...(runId ? { runId } : {}),
          responseState: 'final',
        },
        sessionKey,
      );
    }
    this.currentStreamContentBySession.delete(sessionKey);
    this.currentMessageIdBySession.delete(sessionKey);
    return true;
  }

  private beginRun(sessionKey: string, runId: string): OpenClawRunLease | null {
    const started = this.runProjection.begin(sessionKey, runId);
    if (!started) return null;
    if (started.replacedRunId) {
      this.closeCurrentStreamSegment(sessionKey, undefined, started.replacedRunId);
      this.clearActiveResponse(sessionKey, started.replacedRunId);
    }
    return started.lease;
  }

  private claimTerminal(sessionKey: string, runId: string): OpenClawRunLease | null {
    return this.runProjection.claimTerminal(sessionKey, runId);
  }

  private finalizeAssistantResponse(
    sessionKey: string,
    messageId: string,
    messageText: string,
    lease: OpenClawRunLease,
    media?: MediaInfo,
    usage?: Record<string, number>,
    model?: string | null,
  ) {
    if (!this.runProjection.complete(lease)) return;
    this.clearFinalizeFallback(sessionKey);
    this.forceFlushStream(sessionKey);

    const currentStreamContent = this.currentStreamContentBySession.get(sessionKey) || '';
    const segmentContent = this.getSegmentText(sessionKey, currentStreamContent);
    let finalText = messageText
      ? this.getSegmentText(sessionKey, messageText)
      : segmentContent;
    const runId = lease.runId;
    this.bindRunToSession(sessionKey, runId);
    this.clearActiveResponse(sessionKey, runId);

    finalText = stripDirectives(finalText || '');

    const { cleanContent, blockedCount } = sanitizeWorkshopCommands(finalText);
    const workshopEvents = blockedCount > 0
      ? [{
          kind: 'warning',
          text: i18n.t(
            'chat.untrustedWorkshopCommandIgnored',
            'An untrusted text command was ignored. Use an authorized workspace action instead.',
          ),
        }]
      : [];
    finalText = cleanContent || (blockedCount > 0 ? '' : finalText);

    const btnResult = parseButtons(finalText);
    if (btnResult.buttons.length > 0) {
      finalText = btnResult.cleanContent;
      useChatStore.getState().setQuickReplies(btnResult.buttons, sessionKey);
    } else {
      useChatStore.getState().setQuickReplies([], sessionKey);
    }

    this.conn.callbacks?.onStreamEnd(
      sessionKey,
      messageId,
      finalText,
      media,
      {
        state: 'final',
        refreshHistory: true,
        runId,
        ...(btnResult.buttons.length > 0 ? { decisionOptions: btnResult.buttons } : {}),
        ...(workshopEvents.length > 0 ? { workshopEvents } : {}),
        ...(usage ? { usage } : {}),
        ...(model ? { model } : {}),
      },
    );
  }

  private handleAssistantStream(payload: any) {
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (!sessionKey) return;

    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      debugWarn('gateway', '[GW] Ignoring assistant event without an OpenClaw runId');
      return;
    }
    const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);

    const data = payload.data ?? {};
    const fullText = typeof data.text === 'string' ? data.text : '';
    const delta = typeof data.delta === 'string' ? data.delta : '';
    const nextText = fullText || ((this.currentStreamContentBySession.get(sessionKey) || '') + delta);
    if (!nextText) return;

    const source = this.textStreamSourceBySession.get(sessionKey);
    if (source === 'chat' && activeRunId === runId) return;
    if (!source || activeRunId !== runId) {
      this.textStreamSourceBySession.set(sessionKey, 'agent');
    }

    this.clearFinalizeFallback(sessionKey);
    const currentStreamContent = this.currentStreamContentBySession.get(sessionKey) || '';
    const shouldSplit =
      Boolean(fullText)
      && Boolean(currentStreamContent)
      && fullText !== currentStreamContent
      && !fullText.startsWith(currentStreamContent);
    if (shouldSplit) {
      this.closeCurrentStreamSegment(sessionKey);
      this.streamConsumedBySession.delete(sessionKey);
    }
    const messageId = this.ensureActiveMessageId(sessionKey, runId, payload);
    const comparisonBaseLength = shouldSplit ? 0 : currentStreamContent.length;
    if (nextText.length >= comparisonBaseLength) {
      this.currentStreamContentBySession.set(sessionKey, nextText);
      this.currentRunIdBySession.set(sessionKey, runId);
      this.bindRunToSession(sessionKey, runId);
      const segmentText = this.getSegmentText(sessionKey, nextText);
      this.bufferStreamChunk(sessionKey, messageId, this.getDisplayStreamText(segmentText), undefined, runId);

      const liveThinking = extractThinkingContent(data.content ?? data.message?.content);
      if (liveThinking) {
        useChatStore.getState().setThinkingStream(runId, liveThinking, sessionKey);
      }
    }
  }

  private handleLifecycleStream(payload: any) {
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (!sessionKey) return;
    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      debugWarn('gateway', '[GW] Ignoring lifecycle event without an OpenClaw runId');
      return;
    }

    const phase = typeof payload.data?.phase === 'string' ? payload.data.phase : '';
    if (phase === 'start') {
      if (!this.beginRun(sessionKey, runId)) return;
      this.bindRunToSession(sessionKey, runId);
      const active = this.currentRunIdBySession.get(sessionKey) || '';
      const currentText = this.currentStreamContentBySession.get(sessionKey) || '';
      if (active === runId && currentText.trim()) {
        const consumed = currentText.length;
        this.closeCurrentStreamSegment(sessionKey);
        this.streamConsumedBySession.set(sessionKey, consumed);
      }
      return;
    }

    if (phase !== 'end') return;
    if (!this.runProjection.active(sessionKey, runId)) return;

    this.forceFlushStream(sessionKey);
    this.clearFinalizeFallback(sessionKey);
    const timer = setTimeout(() => {
      const activeRunId = this.currentRunIdBySession.get(sessionKey);
      if (!activeRunId || activeRunId !== runId || !this.runProjection.active(sessionKey, runId)) return;
      // Fallback seals the current assistant segment only — it must NOT trigger
      // onStreamEnd, which would flip typing=false and refreshHistory mid-run
      // (between tool rounds). The true run terminal state is owned exclusively
      // by case 'final'/'aborted'/'error' below.
      this.closeCurrentStreamSegment(sessionKey);
    }, 180);
    this.finalizeFallbackTimers.set(sessionKey, timer);
  }

  // ═══════════════════════════════════════════════════════════
  // Tool Stream Handler — real-time tool execution display
  //
  // `event:"chat"` or `event:"agent"` with `stream:"tool"` / `stream:"item"` (kind tool).
  // Always updates the session tool row — independent of Settings "tool intent" UI toggle.
  // ═══════════════════════════════════════════════════════════
  handleToolStream(payload: any) {
    const data = payload.data ?? {};
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    const toolName = typeof data.name === 'string' ? data.name : 'tool';
    const phase    = typeof data.phase === 'string' ? data.phase : '';

    if (!toolCallId) return;
    const msgId    = `tool-live-${toolCallId}`;

    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    const runId =
      typeof payload.runId === 'string' && payload.runId.trim() ? payload.runId.trim() : '';
    if (!sessionKey || !runId) {
      debugWarn('gateway', '[GW] Ignoring tool event without an OpenClaw sessionKey and runId');
      return;
    }
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);

    const store = useChatStore.getState();
    const listFor = () => store.getCachedMessages(sessionKey) || [];

    if (phase === 'start') {
      const currentContent = this.currentStreamContentBySession.get(sessionKey) || '';
      if (currentContent.trim()) {
        const newConsumed = currentContent.length;
        this.closeCurrentStreamSegment(sessionKey);
        this.streamConsumedBySession.set(sessionKey, newConsumed);
      }
      // Tool is starting — add a 'running' card (idempotent)
      const msgs = listFor();
      if (!msgs.some((m) => m.id === msgId)) {
        const toolInput = data.args && typeof data.args === 'object' ? data.args : {};
        store.addMessage(
          {
            id: msgId,
            role: 'tool',
            content: '',
            runId,
            toolName,
            toolInput,
            toolStatus: 'running',
            responseState: 'streaming',
            timestamp: new Date().toISOString(),
          },
          sessionKey,
        );
      }
      return;
    }

    if (phase === 'update') {
      // Partial result streaming — update existing card
      const partial = data.partialResult != null
        ? (typeof data.partialResult === 'string' ? data.partialResult : JSON.stringify(data.partialResult))
        : '';
      const msgs = listFor();
      const idx  = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const updated = [...msgs];
        updated[idx] = { ...updated[idx], toolOutput: partial.slice(0, 2000) };
        store.setMessages(updated, sessionKey);
      }
      return;
    }

    if (phase === 'result') {
      // Tool complete — finalize with output + duration
      const output = data.result != null
        ? (typeof data.result === 'string' ? data.result : JSON.stringify(data.result))
        : '';
      const msgs = listFor();
      const idx  = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const updated = [...msgs];
        const startTs = typeof payload.ts === 'number' ? payload.ts : 0;
        const durationMs = startTs > 0 ? Date.now() - startTs : undefined;
        updated[idx] = {
          ...updated[idx],
          runId: runId ?? updated[idx].runId ?? null,
          toolOutput: output.slice(0, 2000),
          toolStatus: 'done',
          responseState: 'final',
          ...(durationMs !== undefined ? { toolDurationMs: durationMs } : {}),
        };
        store.setMessages(updated, sessionKey);
      } else {
        // No 'start' event received — add result card directly
        store.addMessage(
          {
            id: msgId,
            role: 'tool',
            content: '',
            runId,
            toolName,
            toolOutput: output.slice(0, 2000),
            toolStatus: 'done',
            responseState: 'final',
            timestamp: new Date().toISOString(),
          },
          sessionKey,
        );
      }
      return;
    }

    debugLog('gateway', '[GW] Tool stream — unknown phase:', phase, toolCallId);
  }

  // ═══════════════════════════════════════════════════════════
  // Thinking Stream Handler — real-time reasoning display
  //
  // Gateway sends: { type:"event", event:"chat", payload: {
  //   stream: "thinking",
  //   runId, sessionKey?,
  //   data: {
  //     text: string,   // full accumulated thinking text
  //     delta: string,  // new portion only
  //   }
  // }}
  // ═══════════════════════════════════════════════════════════
  handleThinkingStream(payload: any) {
    const data = payload.data ?? {};
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (!sessionKey || !runId) {
      debugWarn('gateway', '[GW] Ignoring thinking event without an OpenClaw sessionKey and runId');
      return;
    }
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);

    const store = useChatStore.getState();
    const previousThinking = store.thinkingBySession[sessionKey]?.text || '';
    const text = typeof data.text === 'string'
      ? data.text
      : typeof data.delta === 'string' && data.delta
        ? `${previousThinking}${data.delta}`
        : '';
    if (!text) return;

    store.setThinkingStream(runId, text, sessionKey);
  }

  // ═══════════════════════════════════════════════════════════
  // Event Handler — OpenClaw Protocol
  //
  // Gateway sends: { type:"event", event:"chat", payload: {
  //   state: "delta" | "final" | "error" | "aborted",
  //   message: { role, content },  // content: string | [{type:"text",text:"..."}]
  //   sessionKey, runId
  // }}
  //
  // "delta" = streaming update (accumulated content, NOT a chunk)
  // "final" = complete, fetch full history
  // ═══════════════════════════════════════════════════════════
  handleEvent(msg: any) {
    const event = msg.event || '';
    const p = msg.payload || {};
    const sessionKey = this.resolveSessionKey(p.sessionKey, p.runId);

    if (event === 'agent' || event === 'chat') {
      const acceptance = this.runProjection.acceptEvent(event, p.runId, p.seq);
      if (!acceptance.accepted) return;
      if (acceptance.requiresHistoryRefresh && sessionKey && typeof p.runId === 'string') {
        this.conn.callbacks?.onStreamReconciliationNeeded?.(sessionKey, p.runId);
      }
    }

    if (event === 'session.message') {
      const transcriptSessionKey = this.resolveSessionKey(p.sessionKey, p.runId);
      if (!transcriptSessionKey || isIsolatedExecutionSessionKey(transcriptSessionKey)) return;
      if (this.runProjection.acceptTranscriptUpdate(transcriptSessionKey, p.messageSeq)) {
        this.scheduleTranscriptRefresh(transcriptSessionKey);
      }
      return;
    }

    // ── Direct compaction detection from agent events ──
    // Instead of relying on polling tokenUsage.compactions (unreliable timing),
    // intercept the agent compaction event and inject CompactDivider immediately.
    if (event === 'agent' && p.stream === 'compaction' && p.data?.phase === 'end' && !p.data?.willRetry) {
      if (sessionKey && !isIsolatedExecutionSessionKey(sessionKey)) {
        const now = Date.now();
        if (now - this.lastCompactionTs > 10_000) { // Dedup: max 1 per 10s
          this.lastCompactionTs = now;
          useChatStore.getState().addMessage({
            id: `compaction-live-${now}`,
            role: 'compaction',
            content: '',
            timestamp: new Date().toISOString(),
          }, sessionKey);
          debugLog('gateway', '[GW] 📦 Compaction detected — divider injected');
        }
      }
    }

    if (event === 'agent' && p.stream === 'assistant') {
      if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
      this.handleAssistantStream(p);
      return;
    }

    if (event === 'agent' && p.stream === 'lifecycle') {
      if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
      this.handleLifecycleStream(p);
      return;
    }

    if (event === 'agent' && p.stream === 'tool') {
      if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
      this.handleToolStream(p);
      return;
    }

    if (event === 'agent' && p.stream === 'thinking') {
      if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
      this.handleThinkingStream(p);
      return;
    }

    // Agent "item" stream — newer event format for tool lifecycle.
    if (event === 'agent' && p.stream === 'item' && p.data?.kind === 'tool') {
      if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
      const data = p.data;
      const itemId = typeof data.itemId === 'string' ? data.itemId : '';
      const toolCallId = itemId.replace(/^tool:/, '');
      if (toolCallId) {
        const title = typeof data.title === 'string' ? data.title : '';
        this.handleToolStream({
          sessionKey: p.sessionKey,
          runId: p.runId,
          ts: p.ts || data.startedAt,
          data: {
            toolCallId,
            name: data.name || title.split(/\s/)[0] || 'tool',
            phase: data.phase === 'end' ? 'result' : (data.phase || 'start'),
            args: data.toolArgs || data.args || (title ? { task: title } : {}),
            result: data.output || data.result || '',
          },
        });
      }
      return;
    }

    // Non-chat events → forward to central data store
    if (event !== 'chat') {
      handleGatewayEvent(event, p);
      return;
    }

    // Filter out events from isolated cron/sub-agent sessions
    // Only show messages from main session or sessions the user explicitly opened
    // Block only truly isolated sessions (cron jobs and sub-agent runs).
    // Main sessions may use any suffix: agent:main:main, agent:main:webchat, etc.
    if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) {
      debugLog('gateway', '[GW] Ignoring event from isolated session:', sessionKey);
      return;
    }

    // ── Tool stream events (real-time tool execution) ──
    // payload.stream === "tool" → tool call lifecycle events (start/update/result)
    if (p.stream === 'tool') {
      this.handleToolStream(p);
      return;
    }

    // ── Thinking stream events (real-time reasoning display) ──
    // payload.stream === "thinking" → accumulated reasoning text
    if (p.stream === 'thinking') {
      this.handleThinkingStream(p);
      return;
    }

    // Compaction stream from chat events — already handled above via agent events
    if (p.stream === 'compaction') return;

    const state = p.state || '';
    const runId = p.runId || '';
    let messageText = extractText(p.message?.content);

    // Extract mediaUrl from payload fields
    let mediaUrl = p.mediaUrl || p.message?.mediaUrl || (p.mediaUrls?.length ? p.mediaUrls[0] : undefined);
    let mediaType = p.mediaType || p.message?.mediaType || undefined;

    // Also extract MEDIA: paths/URLs from message content (OpenClaw TTS format)
    // Formats:
    //   MEDIA:http://localhost:5050/audio/xxx.mp3   (HTTP URL — preferred)
    //   MEDIA:/host-d/clawdbot-shared/voice/xxx.mp3 (shared folder path)
    //   MEDIA:/tmp/tts-xxx/voice-123.mp3            (sandbox path — needs conversion)
    const mediaMatch = messageText.match(/MEDIA:(https?:\/\/[^\s]+|\/[^\s]+|[A-Z]:\\[^\s]+)/);
    if (mediaMatch) {
      let mediaPath = mediaMatch[1];
      mediaType = mediaType || 'audio';
      // Remove the MEDIA: line from displayed text
      messageText = messageText.replace(/\n?MEDIA:[^\s]+\n?/g, '').trim();

      if (!mediaUrl) {
        if (/^https?:\/\//.test(mediaPath)) {
          // HTTP URL — use directly (Edge TTS server or any HTTP source)
          mediaUrl = mediaPath;
          debugLog('media', '[GW] 🔊 Media URL (HTTP):', mediaUrl);
        } else {
          // File path — resolve via Electron IPC
          mediaUrl = `aegis-media:${mediaPath}`;
          debugLog('media', '[GW] 🔊 Media path:', mediaPath);
        }
      }
    }

    const media: MediaInfo | undefined = mediaUrl ? { mediaUrl, mediaType } : undefined;

    debugLog('gateway', '[GW] Chat event — state:', state, 'runId:', runId?.substring(0, 12), 'text length:', messageText.length, 'text preview:', messageText.substring(0, 80));

    if (!sessionKey) return;
    const protocolRunId = typeof runId === 'string' ? runId.trim() : '';
    if (!protocolRunId) {
      debugWarn('gateway', '[GW] Ignoring chat event without an OpenClaw runId');
      return;
    }
    const effectiveRunId = protocolRunId;
    this.bindRunToSession(sessionKey, effectiveRunId);

    // ── Reasoning message detection ──
    // When reasoningLevel='on', Gateway sends reasoning as a separate 'final'
    // message prefixed with "Reasoning:" BEFORE the actual response.
    // We intercept it and store as thinking content for the next message.
    const reasoningPrefix = /^Reasoning:\s*/i;
    if (state === 'final' && messageText && reasoningPrefix.test(messageText)) {
      if (!this.beginRun(sessionKey, effectiveRunId)) return;
      const reasoningText = messageText.replace(reasoningPrefix, '').trim();
      if (reasoningText) {
        debugLog('gateway', '[GW] 🧠 Reasoning message captured:', reasoningText.length, 'chars');
        // Store as live thinking, then it will be finalized onto the next assistant message
        useChatStore.getState().setThinkingStream(effectiveRunId, reasoningText, sessionKey);
      }
      this.clearFinalizeFallback(sessionKey);
      this.clearActiveResponse(sessionKey, effectiveRunId);
      return; // Don't show as a regular message
    }

    switch (state) {
      case 'delta': {
        if (!this.beginRun(sessionKey, effectiveRunId)) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        const source = this.textStreamSourceBySession.get(sessionKey);
        const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
        if (source === 'agent' && activeRunId === effectiveRunId) {
          break;
        }
        this.textStreamSourceBySession.set(sessionKey, 'chat');
        // Clean content for display (don't execute workshop commands during streaming)
        let cleaned = messageText;
        cleaned = stripDirectives(cleaned);
        // Strip workshop commands visually (don't execute — that happens on final)
        cleaned = cleaned.replace(/\[\[workshop:\w+(?:\s+\w+="[^"]*")*\]\]/g, '');
        // Strip button markers visually
        cleaned = cleaned.replace(/\[\[button:[^\]]+\]\]/g, '');

        const currentStreamContent = this.currentStreamContentBySession.get(sessionKey) || '';
        if (cleaned.length >= currentStreamContent.length || messageText.length >= currentStreamContent.length) {
          this.currentStreamContentBySession.set(sessionKey, messageText); // Keep RAW for final processing
          this.currentRunIdBySession.set(sessionKey, effectiveRunId);
          // Micro-batch: buffer chunk, flush to React at most every 50ms
          const segmentText = this.getSegmentText(sessionKey, messageText);
          this.bufferStreamChunk(sessionKey, mId, this.getDisplayStreamText(segmentText), media, effectiveRunId);

          const liveThinkingFromBlocks = extractThinkingContent(p.message?.content);
          if (liveThinkingFromBlocks) {
            useChatStore.getState().setThinkingStream(effectiveRunId, liveThinkingFromBlocks, sessionKey);
          }
        }
        break;
      }

      case 'final': {
        const lease = this.claimTerminal(sessionKey, effectiveRunId);
        if (!lease) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        // Message complete — use the most complete version available.
        // When tools are called mid-response, the final event may only contain
        // post-tool text. In that case, keep the accumulated streaming content.
        const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
        const streamContent = !activeRunId || activeRunId === effectiveRunId
          ? (this.currentStreamContentBySession.get(sessionKey) || '')
          : '';
        let finalText = messageText || streamContent;
        if (streamContent && streamContent.length > (messageText?.length || 0)) {
          finalText = streamContent;
        }
        const usage = p.usage && typeof p.usage === 'object'
          ? p.usage
          : p.message?.usage && typeof p.message.usage === 'object'
            ? p.message.usage
            : undefined;
        const model = p.model ?? p.message?.model ?? null;
        this.finalizeAssistantResponse(sessionKey, mId, finalText, lease, media, usage, model);
        break;
      }

      case 'error': {
        const lease = this.claimTerminal(sessionKey, effectiveRunId);
        if (!lease) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        this.forceFlushStream(sessionKey);
        this.clearFinalizeFallback(sessionKey);
        const errorText = p.errorMessage || i18n.t('errors.occurred');
        this.clearActiveResponse(sessionKey, effectiveRunId);
        this.runProjection.complete(lease);
        useChatStore.getState().clearThinking(sessionKey);
        this.conn.callbacks?.onStreamEnd(
          sessionKey,
          mId,
          errorText,
          undefined,
          { state: 'error', runId: effectiveRunId },
        );
        break;
      }

      case 'aborted': {
        const lease = this.claimTerminal(sessionKey, effectiveRunId);
        if (!lease) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        this.forceFlushStream(sessionKey);
        this.clearFinalizeFallback(sessionKey);
        // Use messageText from abort event, fall back to accumulated stream content
        const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
        const currentText = this.currentStreamContentBySession.get(sessionKey) || '';
        const sameRun = !activeRunId || activeRunId === effectiveRunId;
        const finalContent = messageText || (sameRun ? currentText : '');
        this.clearActiveResponse(sessionKey, effectiveRunId);
        this.runProjection.complete(lease);
        useChatStore.getState().clearThinking(sessionKey);

        // Strip directive tags (same as final case)
        const cleaned = finalContent ? stripDirectives(finalContent) : '';

        this.conn.callbacks?.onStreamEnd(
          sessionKey,
          mId,
          cleaned || i18n.t('chat.stopped', 'Stopped'),
          undefined,
          { state: 'aborted', runId: effectiveRunId, refreshHistory: true },
        );
        break;
      }

      default:
        debugLog('gateway', '[GW] Unknown chat state:', state);
    }
  }
}
