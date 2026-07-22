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
import { readGatewayMessageIdentity } from './messageIdentity';
import {
  GatewayConnection,
  type MediaInfo,
} from './Connection';
import {
  classifyOpenClawChatAbortAcknowledgement,
  classifyOpenClawChatSendAcknowledgement,
  OpenClawChatRunProjection,
  parseOpenClawInFlightRunSnapshot,
  type OpenClawRunLease,
  type OpenClawSessionReconciliationOptions,
  type OpenClawSessionRunReconciliation,
} from './OpenClawChatRunProjection';
import {
  OpenClawPendingChatSendRegistry,
  type OpenClawPendingChatSendPhase,
} from './OpenClawPendingChatSend';

// ── Workshop Command Parser ──
// Parses [[workshop:action ...]] commands from agent messages
interface WorkshopCommandResult {
  cleanContent: string;
  blockedCount: number;
}

type TextStreamSource = 'agent' | 'chat';

interface TextStreamSnapshots {
  agent?: string;
  chat?: string;
}

export interface ChatSessionRunObservation {
  sessionKey: string;
  activeRunId: string | null;
  activeRunGeneration: number | null;
  hasActiveRun: boolean;
  typingStartedAt: number | null;
  pendingRunId: string | null;
  pendingRunGeneration: number | null;
  pendingRunPhase: OpenClawPendingChatSendPhase | null;
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

function sessionKeyFromSnapshot(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const record = raw as Record<string, unknown>;
  const value = typeof record.key === 'string' ? record.key : record.sessionKey;
  return typeof value === 'string' ? value.trim() : '';
}

function isOpenClawSessionToolPayload(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const payload = raw as Record<string, unknown>;
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const tool = data as Record<string, unknown>;
  return payload.stream === 'tool'
    && typeof payload.sessionKey === 'string'
    && payload.sessionKey.trim().length > 0
    && typeof payload.runId === 'string'
    && payload.runId.trim().length > 0
    && typeof payload.seq === 'number'
    && Number.isSafeInteger(payload.seq)
    && payload.seq >= 0
    && typeof tool.toolCallId === 'string'
    && tool.toolCallId.trim().length > 0
    && (tool.phase === 'start' || tool.phase === 'update' || tool.phase === 'result');
}

// ═══════════════════════════════════════════════════════════
// ChatHandler Class
// ═══════════════════════════════════════════════════════════

export class ChatHandler {
  // ── Streaming state ──
  private readonly runProjection = new OpenClawChatRunProjection();
  private readonly pendingSends = new OpenClawPendingChatSendRegistry();
  private currentRunIdBySession = new Map<string, string>();
  private currentStreamContentBySession = new Map<string, string>();
  private currentMessageIdBySession = new Map<string, string>();
  private syntheticMessageCounterBySession = new Map<string, number>();
  private completedStreamTextBySession = new Map<string, string>();
  private textStreamSnapshotsBySession = new Map<string, TextStreamSnapshots>();
  private toolStartedAtByKey = new Map<string, number>();
  private lastCompactionTs: number = 0;

  // ── Stream micro-batching ──
  // Buffer WebSocket chunks and flush to React every STREAM_FLUSH_MS
  // to reduce re-renders from every event to ~20 FPS max
  private static readonly STREAM_FLUSH_MS = 50;
  private static readonly MAX_RUN_SESSION_BINDINGS = 512;
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStreams = new Map<string, { id: string; content: string; media?: MediaInfo; runId?: string | null }>();
  private sessionKeyByRunId = new Map<string, string>();
  private transcriptRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recentObservedRunIds = new Map<string, string>();

  constructor(private conn: GatewayConnection) {}

  /** Drop a locally invalidated run after a confirmed reset or deletion. */
  invalidateSession(sessionKey: string): void {
    this.runProjection.invalidate(sessionKey);
    this.pendingSends.invalidate(sessionKey);
    for (const [runId, ownerSessionKey] of this.recentObservedRunIds) {
      if (ownerSessionKey === sessionKey) this.recentObservedRunIds.delete(runId);
    }
    this.clearSessionProjection(sessionKey);
  }

  /** Register the exact idempotency key before local send serialization starts. */
  beginPendingSend(sessionKey: string, runId: string): void {
    const normalizedSessionKey = sessionKey.trim();
    const normalizedRunId = runId.trim();
    if (!normalizedSessionKey || !normalizedRunId) return;
    this.pendingSends.begin(normalizedSessionKey, normalizedRunId);
  }

  /** Preserve ambiguous delivery until official history resolves it. */
  markPendingSendUncertain(sessionKey: string, runId: string): boolean {
    const pending = this.pendingSends.markUncertain(sessionKey.trim(), runId.trim());
    if (!pending) return false;
    this.conn.callbacks?.onSessionRunReconciliationNeeded?.(pending.sessionKey);
    return true;
  }

  /** Release a request that definitively failed before OpenClaw accepted it. */
  failPendingSend(sessionKey: string, runId: string): void {
    this.pendingSends.complete(sessionKey.trim(), runId.trim());
  }

  /** Prefer OpenClaw's exact run abort whenever ownership is known. */
  abortRunId(sessionKey: string): string | null {
    return this.runProjection.active(sessionKey)?.runId
      ?? this.pendingSends.current(sessionKey)?.runId
      ?? null;
  }

  isSendObserved(sessionKey: string, runId: string): boolean {
    return this.runProjection.active(sessionKey, runId) !== null
      || this.recentObservedRunIds.get(runId) === sessionKey;
  }

  /** Fold the official idempotent `chat.send` acknowledgement into run state. */
  reconcileSendAcknowledgement(
    sessionKey: string,
    expectedRunId: string,
    response: unknown,
  ): 'active' | 'settled' | 'unknown' {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return 'unknown';
    const acknowledgement = classifyOpenClawChatSendAcknowledgement(response, expectedRunId);
    if (acknowledgement.state === 'unknown') return 'unknown';
    this.completePendingSend(normalizedSessionKey, acknowledgement.runId);
    const currentLease = this.runProjection.active(normalizedSessionKey);
    // A delayed retry acknowledgement must never replace a newer run already
    // observed on this session.
    if (currentLease && currentLease.runId !== acknowledgement.runId) return acknowledgement.state;
    const lease = currentLease ?? this.beginRun(normalizedSessionKey, acknowledgement.runId);
    if (!lease) return acknowledgement.state;
    this.bindRunToSession(normalizedSessionKey, acknowledgement.runId);
    if (acknowledgement.state === 'active') return 'active';

    const terminalLease = this.claimTerminal(normalizedSessionKey, acknowledgement.runId);
    if (!terminalLease || !this.runProjection.complete(terminalLease)) return 'settled';
    this.applySessionRunReconciliations([{
      sessionKey: normalizedSessionKey,
      state: 'settled',
      activeRunIds: [],
    }]);
    return 'settled';
  }

  /** Apply only the exact runs confirmed by OpenClaw's `chat.abort` result. */
  reconcileAbortAcknowledgement(sessionKey: string, response: unknown): boolean {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return false;
    const acknowledgement = classifyOpenClawChatAbortAcknowledgement(response);
    if (acknowledgement.state !== 'aborted') {
      if (acknowledgement.state === 'not_aborted') {
        this.conn.callbacks?.onSessionRunReconciliationNeeded?.(normalizedSessionKey);
      }
      return false;
    }

    let settled = false;
    for (const runId of acknowledgement.runIds) {
      const active = this.runProjection.active(normalizedSessionKey);
      if (active && active.runId !== runId) continue;
      const pending = this.pendingSends.current(normalizedSessionKey);
      if (!active && pending?.runId !== runId && !this.runProjection.hasActiveSession(normalizedSessionKey)) {
        continue;
      }
      const lease = this.claimTerminal(normalizedSessionKey, runId);
      if (!lease) continue;
      const messageId = this.ensureActiveMessageId(normalizedSessionKey, runId);
      const content = this.currentRunIdBySession.get(normalizedSessionKey) === runId
        ? this.currentStreamContentBySession.get(normalizedSessionKey) || ''
        : '';
      this.finalizeAbortedResponse(normalizedSessionKey, messageId, content, lease);
      settled = true;
    }
    return settled;
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
  reconcileSessionRuns(
    sessions: unknown[],
    options: OpenClawSessionReconciliationOptions = {},
    observations?: readonly ChatSessionRunObservation[],
  ): string[] {
    const currentPendingSessions = new Set([
      ...this.runProjection.activeSessionKeys(),
      ...this.pendingSends.sessionKeys(),
      ...Object.entries(useChatStore.getState().typingBySession)
        .filter(([, typing]) => typing)
        .map(([sessionKey]) => sessionKey),
    ]);
    const snapshotConfirmsPendingSend = (raw: unknown): boolean => {
      const sessionKey = sessionKeyFromSnapshot(raw);
      const pending = this.pendingSends.current(sessionKey);
      if (!pending || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return false;
      }
      const activeRunIds = (raw as Record<string, unknown>).activeRunIds;
      return Array.isArray(activeRunIds) && activeRunIds.some((value) => (
        typeof value === 'string' && value.trim() === pending.runId
      ));
    };
    const protectedPendingSessionKeys = new Set(this.pendingSends.sessionKeys());
    const confirmedPendingSessionKeys = new Set(
      sessions.flatMap((session) => (
        snapshotConfirmsPendingSend(session) ? [sessionKeyFromSnapshot(session)] : []
      )),
    );
    let reconciliationSessions = sessions.filter((session) => {
      const sessionKey = sessionKeyFromSnapshot(session);
      return !protectedPendingSessionKeys.has(sessionKey)
        || confirmedPendingSessionKeys.has(sessionKey);
    });
    let pendingSessions = currentPendingSessions;
    if (observations) {
      const observationsBySession = new Map(
        observations.map((observation) => [observation.sessionKey, observation]),
      );
      const unsafeSessionKeys = new Set<string>();
      for (const observation of observations) {
        if (!this.isSessionRunObservationCurrent(observation)) {
          unsafeSessionKeys.add(observation.sessionKey);
        }
      }
      for (const sessionKey of currentPendingSessions) {
        if (!observationsBySession.has(sessionKey)) unsafeSessionKeys.add(sessionKey);
      }
      reconciliationSessions = reconciliationSessions.filter((session) => (
        !unsafeSessionKeys.has(sessionKeyFromSnapshot(session))
      ));
      pendingSessions = new Set(
        [...currentPendingSessions].filter((sessionKey) => (
          !unsafeSessionKeys.has(sessionKey)
          && !protectedPendingSessionKeys.has(sessionKey)
        )),
      );
    } else if (protectedPendingSessionKeys.size > 0) {
      pendingSessions = new Set(
        [...currentPendingSessions].filter((sessionKey) => !protectedPendingSessionKeys.has(sessionKey)),
      );
    }
    const resolutions = this.runProjection.reconcileSessionSnapshots(
      reconciliationSessions,
      pendingSessions,
      options,
    );
    this.completePendingSendsFromSnapshots(reconciliationSessions, resolutions);
    this.applySessionRunReconciliations(resolutions);
    const pendingSessionsRequiringHistory = [...protectedPendingSessionKeys].filter((sessionKey) => (
      this.pendingSends.current(sessionKey) !== null
    ));
    return [...new Set([
      ...this.runProjection.unresolvedSessionKeys(reconciliationSessions, pendingSessions, options),
      ...pendingSessionsRequiringHistory,
    ])];
  }

  settleMissingSession(sessionKey: string): void {
    if (this.pendingSends.current(sessionKey)?.phase === 'dispatching') return;
    this.failUnconfirmedPendingSend(sessionKey);
    this.applySessionRunReconciliations(
      this.runProjection.reconcileSessionSnapshots([], [sessionKey], { settleMissing: true }),
    );
  }

  captureSessionRunObservation(sessionKey: string): ChatSessionRunObservation {
    const active = this.runProjection.active(sessionKey);
    const pending = this.pendingSends.current(sessionKey);
    const typingStartedAt = useChatStore.getState().typingStartedAtBySession[sessionKey];
    return {
      sessionKey,
      activeRunId: active?.runId ?? null,
      activeRunGeneration: active?.generation ?? null,
      hasActiveRun: this.runProjection.hasActiveSession(sessionKey),
      typingStartedAt: typeof typingStartedAt === 'number' ? typingStartedAt : null,
      pendingRunId: pending?.runId ?? null,
      pendingRunGeneration: pending?.generation ?? null,
      pendingRunPhase: pending?.phase ?? null,
    };
  }

  capturePendingSessionRunObservations(): ChatSessionRunObservation[] {
    const sessionKeys = new Set([
      ...this.runProjection.activeSessionKeys(),
      ...this.pendingSends.sessionKeys(),
      ...Object.entries(useChatStore.getState().typingBySession)
        .filter(([, typing]) => typing)
        .map(([sessionKey]) => sessionKey),
    ]);
    return [...sessionKeys].map((sessionKey) => this.captureSessionRunObservation(sessionKey));
  }

  isSessionRunObservationCurrent(observation: ChatSessionRunObservation): boolean {
    const current = this.captureSessionRunObservation(observation.sessionKey);
    return current.activeRunId === observation.activeRunId
      && current.activeRunGeneration === observation.activeRunGeneration
      && current.hasActiveRun === observation.hasActiveRun
      && current.typingStartedAt === observation.typingStartedAt
      && current.pendingRunId === observation.pendingRunId
      && current.pendingRunGeneration === observation.pendingRunGeneration
      && current.pendingRunPhase === observation.pendingRunPhase;
  }

  /** Reconcile a complete `chat.history` response, including its live buffer. */
  reconcileHistoryRunState(
    sessionKey: string,
    response: unknown,
    observation?: ChatSessionRunObservation,
  ): void {
    if (observation && !this.isSessionRunObservationCurrent(observation)) return;
    if (!response || typeof response !== 'object' || Array.isArray(response)) return;
    const record = response as Record<string, unknown>;
    const inFlight = parseOpenClawInFlightRunSnapshot(response);
    const rawSessionInfo = record.sessionInfo;
    const sessionInfo = rawSessionInfo && typeof rawSessionInfo === 'object' && !Array.isArray(rawSessionInfo)
      ? rawSessionInfo as Record<string, unknown>
      : null;

    const pending = this.pendingSends.current(sessionKey);
    if (pending?.phase === 'dispatching' && inFlight?.runId !== pending.runId) return;

    if (inFlight) {
      this.completePendingSend(sessionKey, inFlight.runId);
      this.applySessionRunReconciliations([
        this.runProjection.adoptInFlightRun(sessionKey, inFlight.runId),
      ]);
    } else {
      const snapshot: Record<string, unknown> | null = sessionInfo
        ? { ...sessionInfo, key: sessionKey }
        : null;
      if (!snapshot || typeof snapshot.hasActiveRun !== 'boolean') return;
      if (snapshot.hasActiveRun === false && pending?.phase === 'uncertain') {
        if (this.historyContainsRunIdentity(record, pending.runId)) {
          this.completePendingSend(sessionKey, pending.runId);
        } else {
          this.failUnconfirmedPendingSend(sessionKey, pending.runId);
        }
      }
      const resolutions = this.runProjection.reconcileSessionSnapshots([snapshot], [sessionKey]);
      this.completePendingSendsFromSnapshots([snapshot], resolutions);
      this.applySessionRunReconciliations(resolutions);
    }
    if (!inFlight || !this.runProjection.active(sessionKey, inFlight.runId)) return;

    this.bindRunToSession(sessionKey, inFlight.runId);
    const messageId = this.ensureActiveMessageId(sessionKey, inFlight.runId);
    const selectedText = this.updateStreamSnapshot(sessionKey, 'chat', inFlight.text, true);
    this.currentStreamContentBySession.set(sessionKey, selectedText);
    this.currentRunIdBySession.set(sessionKey, inFlight.runId);
    if (selectedText) {
      const segmentText = this.getSegmentText(sessionKey, selectedText);
      this.bufferStreamChunk(
        sessionKey,
        messageId,
        this.getDisplayStreamText(segmentText),
        undefined,
        inFlight.runId,
      );
    }
  }

  /** Observe runs discovered by a normal sessions refresh without settling local work. */
  observeActiveSessionRuns(sessions: unknown[]): void {
    const resolutions = this.runProjection.observeActiveSessionSnapshots(sessions);
    this.completePendingSendsFromSnapshots(sessions, resolutions);
    this.applySessionRunReconciliations(resolutions);
  }

  private applySessionRunReconciliations(
    resolutions: OpenClawSessionRunReconciliation[],
  ): void {
    for (const resolution of resolutions) {
      if (resolution.state === 'settled') {
        this.closeCurrentStreamSegment(resolution.sessionKey);
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

  private rememberObservedRun(sessionKey: string, runId: string): void {
    this.recentObservedRunIds.delete(runId);
    this.recentObservedRunIds.set(runId, sessionKey);
    while (this.recentObservedRunIds.size > ChatHandler.MAX_RUN_SESSION_BINDINGS) {
      const oldestRunId = this.recentObservedRunIds.keys().next().value;
      if (oldestRunId === undefined) break;
      this.recentObservedRunIds.delete(oldestRunId);
    }
  }

  private completePendingSend(sessionKey: string, runId: string): boolean {
    const completed = this.pendingSends.complete(sessionKey, runId);
    if (!completed) return false;
    this.rememberObservedRun(sessionKey, runId);
    useChatStore.getState().confirmPendingMessageDeliveries(sessionKey, [runId]);
    return true;
  }

  private completePendingSendsFromSnapshots(
    snapshots: unknown[],
    resolutions: OpenClawSessionRunReconciliation[],
  ): void {
    const activeRunIdsBySession = new Map<string, Set<string>>();
    for (const raw of snapshots) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const record = raw as Record<string, unknown>;
      const sessionKey = sessionKeyFromSnapshot(record);
      if (!sessionKey || !Array.isArray(record.activeRunIds)) continue;
      activeRunIdsBySession.set(sessionKey, new Set(record.activeRunIds.flatMap((value) => (
        typeof value === 'string' && value.trim() ? [value.trim()] : []
      ))));
    }
    for (const resolution of resolutions) {
      const pending = this.pendingSends.current(resolution.sessionKey);
      if (!pending) continue;
      if (resolution.state === 'settled') {
        continue;
      }
      if (activeRunIdsBySession.get(resolution.sessionKey)?.has(pending.runId)) {
        this.completePendingSend(resolution.sessionKey, pending.runId);
      }
    }
  }

  private historyContainsRunIdentity(response: Record<string, unknown>, runId: string): boolean {
    const messages = Array.isArray(response.messages) ? response.messages : [];
    return messages.some((message) => readGatewayMessageIdentity(message).clientMessageId === runId);
  }

  private failUnconfirmedPendingSend(sessionKey: string, runId?: string): void {
    const pending = this.pendingSends.complete(sessionKey, runId);
    if (!pending) return;
    useChatStore.getState().updateMessage(sessionKey, pending.runId, {
      status: 'failed',
      deliveryError: i18n.t(
        'chat.deliveryNotConfirmed',
        'OpenClaw did not confirm this message. You can retry it safely.',
      ),
    });
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
      if (!pending.content && !pending.media) {
        this.pendingStreams.delete(key);
        continue;
      }
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
    // A directive-only or whitespace segment cannot render on its own. Do not
    // allocate an assistant placeholder that a later tool boundary could strand.
    if (!content.trim() && !media) return;
    this.pendingStreams.set(sessionKey, { id, content, media, runId });

    if (!this.streamFlushTimer) {
      this.streamFlushTimer = setTimeout(() => this.flushStream(), ChatHandler.STREAM_FLUSH_MS);
    }
  }

  /** Force-flush any pending stream content (called before final/error/abort) */
  private forceFlushStream(_sessionKey?: string) {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    // The scheduler is shared, so cancelling it must flush every buffered
    // session. Flushing only one would strand the others with no future timer.
    this.flushStream();
  }

  private clearTranscriptRefresh(sessionKey: string): void {
    const timer = this.transcriptRefreshTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      this.transcriptRefreshTimers.delete(sessionKey);
    }
  }

  private scheduleTranscriptRefresh(sessionKey: string): void {
    if (this.runProjection.hasActiveSession(sessionKey)) return;
    if (this.transcriptRefreshTimers.has(sessionKey)) return;
    const timer = setTimeout(() => {
      this.transcriptRefreshTimers.delete(sessionKey);
      this.conn.callbacks?.onTranscriptChanged?.(sessionKey);
    }, 75);
    this.transcriptRefreshTimers.set(sessionKey, timer);
  }

  private markTranscriptHandledByTerminal(sessionKey: string): void {
    this.clearTranscriptRefresh(sessionKey);
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
    const completed = this.completedStreamTextBySession.get(sessionKey) || '';
    return completed && rawContent.startsWith(completed)
      ? rawContent.slice(completed.length)
      : rawContent;
  }

  private recordCompletedStreamSegment(sessionKey: string, rawContent: string, segmentText: string): void {
    if (!segmentText) return;
    const completed = this.completedStreamTextBySession.get(sessionKey) || '';
    this.completedStreamTextBySession.set(
      sessionKey,
      completed && rawContent.startsWith(completed) ? rawContent : `${completed}${segmentText}`,
    );
  }

  private sourceSnapshot(sessionKey: string, source: TextStreamSource): string {
    return this.textStreamSnapshotsBySession.get(sessionKey)?.[source] || '';
  }

  private updateStreamSnapshot(
    sessionKey: string,
    source: TextStreamSource,
    nextText: string,
    replace = false,
  ): string {
    const snapshots = this.textStreamSnapshotsBySession.get(sessionKey) || {};
    const previous = snapshots[source] || '';
    const normalized = !replace && previous && previous.startsWith(nextText)
      ? previous
      : nextText;
    const nextSnapshots = { ...snapshots, [source]: normalized };
    this.textStreamSnapshotsBySession.set(sessionKey, nextSnapshots);

    const chat = nextSnapshots.chat || '';
    const agent = nextSnapshots.agent || '';
    if (!chat) return agent;
    if (!agent) return chat;
    if (chat.startsWith(agent)) return chat;
    if (agent.startsWith(chat)) return agent;
    // Divergence represents an explicit chat replacement or a provider text
    // correction. Prefer the client projection until the agent stream grows
    // from that corrected prefix again.
    return chat;
  }

  private toolTimingKey(sessionKey: string, runId: string, toolCallId: string): string {
    return `${sessionKey}\u0000${runId}\u0000${toolCallId}`;
  }

  private clearToolTimings(sessionKey: string, runId?: string): void {
    const prefix = `${sessionKey}\u0000${runId ?? ''}`;
    for (const key of this.toolStartedAtByKey.keys()) {
      if (runId ? key.startsWith(prefix) : key.startsWith(`${sessionKey}\u0000`)) {
        this.toolStartedAtByKey.delete(key);
      }
    }
  }

  private clearSessionProjection(sessionKey: string): void {
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
    this.completedStreamTextBySession.delete(sessionKey);
    this.textStreamSnapshotsBySession.delete(sessionKey);
    this.clearToolTimings(sessionKey, runId);
    const pending = this.pendingStreams.get(sessionKey);
    if (!expectedRunId || !pending?.runId || pending.runId === expectedRunId) {
      this.pendingStreams.delete(sessionKey);
    }
    return true;
  }

  private closeCurrentStreamSegment(sessionKey: string, media?: MediaInfo, expectedRunId?: string): boolean {
    const activeRunId = this.currentRunIdBySession.get(sessionKey);
    if (expectedRunId && activeRunId && activeRunId !== expectedRunId) return false;
    this.forceFlushStream(sessionKey);
    const messageId = this.currentMessageIdBySession.get(sessionKey);
    const content = this.currentStreamContentBySession.get(sessionKey) || '';
    const segmentText = this.getSegmentText(sessionKey, content);
    if (messageId && (segmentText.trim() || media)) {
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
    } else if (messageId) {
      useChatStore.getState().discardEmptyStreamingMessage(messageId, sessionKey);
    }
    this.recordCompletedStreamSegment(sessionKey, content, segmentText);
    // A tool boundary starts a fresh live segment. The completed prefix above
    // still lets either stream channel report a full cumulative snapshot.
    this.textStreamSnapshotsBySession.delete(sessionKey);
    this.currentStreamContentBySession.delete(sessionKey);
    this.currentMessageIdBySession.delete(sessionKey);
    return true;
  }

  private beginRun(sessionKey: string, runId: string): OpenClawRunLease | null {
    const started = this.runProjection.begin(sessionKey, runId);
    if (!started) return null;
    // Any run event is an authoritative acknowledgement that the Gateway
    // accepted the user's request. Do not keep its optimistic bubble pending
    // while the assistant is working or after a later abort.
    this.completePendingSend(sessionKey, runId);
    useChatStore.getState().setIsTyping(true, sessionKey);
    if (started.replacedRunId) {
      this.closeCurrentStreamSegment(sessionKey, undefined, started.replacedRunId);
      this.clearActiveResponse(sessionKey, started.replacedRunId);
    }
    return started.lease;
  }

  private claimTerminal(sessionKey: string, runId: string): OpenClawRunLease | null {
    this.completePendingSend(sessionKey, runId);
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
    this.rememberObservedRun(sessionKey, lease.runId);
    this.markTranscriptHandledByTerminal(sessionKey);
    this.forceFlushStream(sessionKey);

    let finalText = this.getSegmentText(sessionKey, messageText);
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

  private finalizeErroredResponse(
    sessionKey: string,
    messageId: string,
    errorText: string,
    lease: OpenClawRunLease,
  ): void {
    if (!this.runProjection.complete(lease)) return;
    this.rememberObservedRun(sessionKey, lease.runId);
    this.forceFlushStream(sessionKey);
    this.clearActiveResponse(sessionKey, lease.runId);
    this.markTranscriptHandledByTerminal(sessionKey);
    useChatStore.getState().clearThinking(sessionKey);
    this.conn.callbacks?.onStreamEnd(
      sessionKey,
      messageId,
      errorText,
      undefined,
      { state: 'error', runId: lease.runId, refreshHistory: true },
    );
  }

  private finalizeAbortedResponse(
    sessionKey: string,
    messageId: string,
    content: string,
    lease: OpenClawRunLease,
  ): void {
    if (!this.runProjection.complete(lease)) return;
    this.rememberObservedRun(sessionKey, lease.runId);
    this.forceFlushStream(sessionKey);
    this.clearActiveResponse(sessionKey, lease.runId);
    this.markTranscriptHandledByTerminal(sessionKey);
    useChatStore.getState().clearThinking(sessionKey);
    const cleaned = content ? stripDirectives(content) : '';
    this.conn.callbacks?.onStreamEnd(
      sessionKey,
      messageId,
      cleaned || i18n.t('chat.stopped', 'Stopped'),
      undefined,
      { state: 'aborted', runId: lease.runId, refreshHistory: true },
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
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);

    const data = payload.data ?? {};
    const fullText = typeof data.text === 'string' ? data.text : '';
    const delta = typeof data.delta === 'string' ? data.delta : '';
    const previousSourceText = this.sourceSnapshot(sessionKey, 'agent');
    const nextText = fullText || `${previousSourceText}${delta}`;
    if (!nextText) return;

    // Agent and chat are two projections of the same OpenClaw run. Text
    // differences between them are corrections or transport timing, not a
    // message boundary. Tool lifecycle events are the only explicit segment
    // boundary and already close the current segment above.
    const messageId = this.ensureActiveMessageId(sessionKey, runId, payload);
    const selectedText = this.updateStreamSnapshot(
      sessionKey,
      'agent',
      nextText,
      data.replace === true,
    );
    this.currentStreamContentBySession.set(sessionKey, selectedText);
    this.currentRunIdBySession.set(sessionKey, runId);
    this.bindRunToSession(sessionKey, runId);
    const segmentText = this.getSegmentText(sessionKey, selectedText);
    this.bufferStreamChunk(sessionKey, messageId, this.getDisplayStreamText(segmentText), undefined, runId);

    const liveThinking = extractThinkingContent(data.content ?? data.message?.content);
    if (liveThinking) {
      useChatStore.getState().setThinkingStream(runId, liveThinking, sessionKey);
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
      return;
    }

    if (phase !== 'end' && phase !== 'error') return;
    // OpenClaw keeps ordinary lifecycle errors alive while it evaluates
    // provider fallback/retry. Lifecycle events are not chat terminal events;
    // ask the official session snapshot to resolve ownership instead of
    // inventing a client-side completion timeout.
    if (phase === 'error' && payload.data?.fallbackExhaustedFailure !== true) return;

    this.forceFlushStream(sessionKey);
    this.conn.callbacks?.onSessionRunReconciliationNeeded?.(sessionKey);
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

    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    const runId =
      typeof payload.runId === 'string' && payload.runId.trim() ? payload.runId.trim() : '';
    if (!sessionKey || !runId) {
      debugWarn('gateway', '[GW] Ignoring tool event without an OpenClaw sessionKey and runId');
      return;
    }
    const msgId = `tool-live-${runId}-${toolCallId}`;
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);

    const store = useChatStore.getState();
    const listFor = () => store.getCachedMessages(sessionKey) || [];

    if (phase === 'start') {
      const currentContent = this.currentStreamContentBySession.get(sessionKey) || '';
      if (currentContent.trim()) {
        this.closeCurrentStreamSegment(sessionKey);
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
      const timingKey = this.toolTimingKey(sessionKey, runId, toolCallId);
      if (!this.toolStartedAtByKey.has(timingKey)) this.toolStartedAtByKey.set(timingKey, Date.now());
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
        const timingKey = this.toolTimingKey(sessionKey, runId, toolCallId);
        const startedAt = this.toolStartedAtByKey.get(timingKey);
        this.toolStartedAtByKey.delete(timingKey);
        const durationMs = startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt);
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
  // OpenClaw emits reasoning as a structured `agent` stream. The `chat`
  // branch remains for protocol-compatible older gateways.
  // { type:"event", event:"agent", payload: {
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
    if (event === 'session.tool' && !isOpenClawSessionToolPayload(p)) {
      debugWarn('gateway', '[GW] Ignoring malformed OpenClaw session.tool event');
      return;
    }
    const sessionKey = this.resolveSessionKey(p.sessionKey, p.runId);

    if (event === 'agent' || event === 'chat' || event === 'session.tool') {
      const terminal = event === 'chat'
        && (p.state === 'final' || p.state === 'error' || p.state === 'aborted');
      // OpenClaw mirrors the standard agent tool payload onto `session.tool`
      // for clients that subscribed after a run had already started. It uses
      // the same run-level sequence, so both transports share one ordering
      // fence and cannot render the same tool lifecycle twice.
      const runEventSource = event === 'session.tool' ? 'agent' : event;
      const acceptance = this.runProjection.acceptEvent(runEventSource, p.runId, p.seq, { terminal });
      if (!acceptance.accepted) return;
      if (acceptance.requiresHistoryRefresh && sessionKey && typeof p.runId === 'string') {
        this.conn.callbacks?.onStreamReconciliationNeeded?.(sessionKey, p.runId);
      }
    }

    if (event === 'session.tool') {
      // v2026.7.1 contract: the event payload is the agent tool payload itself
      // (`runId`, `seq`, `stream`, `ts`, `data`) plus a session snapshot. Do
      // not unwrap or translate fields that the Gateway did not send.
      if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
      this.handleToolStream(p);
      return;
    }

    if (event === 'session.message') {
      const transcriptSessionKey = this.resolveSessionKey(p.sessionKey, p.runId);
      if (!transcriptSessionKey || isIsolatedExecutionSessionKey(transcriptSessionKey)) return;
      if (this.runProjection.acceptTranscriptUpdate(transcriptSessionKey, p.messageSeq)) {
        let settledBySnapshot = false;
        const activeRun = this.runProjection.active(transcriptSessionKey);
        const hasAnonymousActiveRun = !activeRun
          && this.runProjection.hasActiveSession(transcriptSessionKey);
        const transcriptRole = typeof p.message?.role === 'string' ? p.message.role : '';
        const transcriptRunId = readGatewayMessageIdentity(p.message).clientMessageId;
        const transcriptIdentity = readGatewayMessageIdentity(p.message);
        this.conn.callbacks?.onTranscriptMessage?.({
          sessionKey: transcriptSessionKey,
          role: transcriptRole,
          text: extractText(p.message?.content),
          ...(transcriptIdentity.nativeMessageId
            ? { nativeMessageId: transcriptIdentity.nativeMessageId }
            : {}),
          ...(transcriptIdentity.clientMessageId
            ? { clientMessageId: transcriptIdentity.clientMessageId }
            : {}),
          ...(typeof p.messageSeq === 'number' ? { messageSeq: p.messageSeq } : {}),
          liveProjected: Boolean(
            transcriptRunId
            && (
              activeRun?.runId === transcriptRunId
              || this.pendingSends.current(transcriptSessionKey)?.runId === transcriptRunId
              || this.recentObservedRunIds.get(transcriptRunId) === transcriptSessionKey
            )
          ),
        });
        const transcriptSettlesActiveRun = Boolean(
          activeRun
          && transcriptRole === 'assistant'
          && transcriptRunId === activeRun.runId,
        );
        const shouldReconcileSnapshot = p.hasActiveRun === true
          || (p.hasActiveRun === false && (hasAnonymousActiveRun || transcriptSettlesActiveRun));
        if (shouldReconcileSnapshot) {
          const snapshot = [{ ...p, key: transcriptSessionKey }];
          const resolutions = this.runProjection.reconcileSessionSnapshots(
            snapshot,
            [transcriptSessionKey],
          );
          this.completePendingSendsFromSnapshots(snapshot, resolutions);
          settledBySnapshot = resolutions.some((resolution) => resolution.state === 'settled');
          if (settledBySnapshot) {
            this.clearTranscriptRefresh(transcriptSessionKey);
          }
          this.applySessionRunReconciliations(resolutions);
        } else if (
          p.hasActiveRun === false
          && (activeRun || useChatStore.getState().typingBySession[transcriptSessionKey])
        ) {
          // The snapshot is authoritative, but an older durable assistant
          // message can arrive after a newer local run starts. Without an
          // exact idempotency-key match, resolve current run ownership through
          // sessions.list/chat.history instead of settling the newer run.
          this.conn.callbacks?.onSessionRunReconciliationNeeded?.(transcriptSessionKey);
        }
        // A settled reconciliation already asks the application for durable
        // history. Active runs defer transcript merging until their terminal
        // event so native history cannot race the live assistant message.
        if (!settledBySnapshot) this.scheduleTranscriptRefresh(transcriptSessionKey);
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

    switch (state) {
      case 'delta': {
        if (!this.beginRun(sessionKey, effectiveRunId)) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        if (!messageText && !media) break;
        const selectedText = this.updateStreamSnapshot(
          sessionKey,
          'chat',
          messageText,
          p.replace === true,
        );
        this.currentStreamContentBySession.set(sessionKey, selectedText);
        this.currentRunIdBySession.set(sessionKey, effectiveRunId);
        const segmentText = this.getSegmentText(sessionKey, selectedText);
        this.bufferStreamChunk(sessionKey, mId, this.getDisplayStreamText(segmentText), media, effectiveRunId);

        const liveThinkingFromBlocks = extractThinkingContent(p.message?.content);
        if (liveThinkingFromBlocks) {
          useChatStore.getState().setThinkingStream(effectiveRunId, liveThinkingFromBlocks, sessionKey);
        }
        break;
      }

      case 'final': {
        const lease = this.claimTerminal(sessionKey, effectiveRunId);
        if (!lease) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        // OpenClaw flushes buffered deltas before chat.final and sends the
        // canonical buffered text in the terminal message. Only fall back to
        // the local projection when the terminal carries no message.
        const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
        const streamContent = !activeRunId || activeRunId === effectiveRunId
          ? (this.currentStreamContentBySession.get(sessionKey) || '')
          : '';
        const hasCanonicalMessage = p.message !== undefined && p.message !== null;
        const finalText = hasCanonicalMessage ? messageText : streamContent;
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
        const errorText = p.errorMessage || i18n.t('errors.occurred');
        this.finalizeErroredResponse(sessionKey, mId, errorText, lease);
        break;
      }

      case 'aborted': {
        const lease = this.claimTerminal(sessionKey, effectiveRunId);
        if (!lease) return;
        const mId = this.ensureActiveMessageId(sessionKey, effectiveRunId, p);
        // Use messageText from abort event, fall back to accumulated stream content
        const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
        const currentText = this.currentStreamContentBySession.get(sessionKey) || '';
        const sameRun = !activeRunId || activeRunId === effectiveRunId;
        const finalContent = messageText || (sameRun ? currentText : '');
        this.finalizeAbortedResponse(sessionKey, mId, finalContent, lease);
        break;
      }

      default:
        debugLog('gateway', '[GW] Unknown chat state:', state);
    }
  }
}
