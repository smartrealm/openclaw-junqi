// ═══════════════════════════════════════════════════════════
// ChatHandler —— Chat 事件运行时投影
// 接收 Gateway 事件并更新聊天与工具状态，不拥有 WebSocket 传输。
// ═══════════════════════════════════════════════════════════

import { extractText, stripDirectives } from '@/processing/TextCleaner';
import { extractThinkingContent } from '@/processing/normalizeGatewayMessage';
import {
  parseOpenClawLiveGatewayEvent,
  resolveOpenClawChatDeltaText,
  type OpenClawLiveAgentEventPayload,
  type OpenClawLiveChatEventPayload,
} from '@/processing/openClawChatEvent';
import {
  normalizeGatewayToolLifecycleEvent,
  projectToolOutput,
  type GatewayToolEventSource,
} from '@/processing/toolExecutionProjection';
import { handleGatewayEvent } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { parseButtons } from '@/utils/buttonParser';
import { debugLog, debugWarn } from '@/utils/debugLog';
import { isIsolatedExecutionSessionKey } from '@/utils/sessionPresentation';
import i18n from '@/i18n';
import { readGatewayMessageIdentity } from '@/services/gateway/messageIdentity';
import {
  type GatewayCallbacks,
  type MediaInfo,
} from '@/services/gateway/Connection';
import {
  classifyOpenClawSessionAbortAcknowledgement,
  classifyOpenClawChatSendAcknowledgement,
  OpenClawChatRunProjection,
  parseOpenClawInFlightRunSnapshot,
  type OpenClawRunLease,
  type OpenClawSessionReconciliationOptions,
  type OpenClawSessionRunReconciliation,
} from '@/services/gateway/OpenClawChatRunProjection';
import {
  OpenClawPendingChatSendRegistry,
} from '@/services/gateway/OpenClawPendingChatSend';
import type { ChatSessionRunObservation } from '@/services/gateway/OpenClawPendingRunWaitReconciler';
import { parseOpenClawChatSendTiming } from '@/services/gateway/chatSendTiming';
import {
  parseOpenClawSessionOperationEvent,
} from '@/services/gateway/sessionOperation';

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

/** The chat projection depends only on Gateway callback delivery, not transport internals. */
type ChatHandlerCallbacks = Pick<GatewayCallbacks, 'onStreamChunk' | 'onStreamEnd'>
  & Partial<GatewayCallbacks>;

export interface ChatHandlerConnection {
  callbacks: ChatHandlerCallbacks | null;
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

function gatewayRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sessionKeyFromSnapshot(raw: unknown): string {
  const record = gatewayRecord(raw);
  if (!record) return '';
  const value = typeof record.key === 'string' ? record.key : record.sessionKey;
  return typeof value === 'string' ? value.trim() : '';
}

function messageRecord(value: unknown): Record<string, unknown> | null {
  return gatewayRecord(value);
}

function messageContent(value: unknown): unknown {
  return messageRecord(value)?.content;
}

function messageMedia(value: unknown): MediaInfo | undefined {
  const source = messageRecord(value);
  const mediaUrl = typeof source?.mediaUrl === 'string' && source.mediaUrl.trim()
    ? source.mediaUrl
    : undefined;
  const mediaType = typeof source?.mediaType === 'string' && source.mediaType.trim()
    ? source.mediaType
    : undefined;
  return mediaUrl ? { mediaUrl, ...(mediaType ? { mediaType } : {}) } : undefined;
}

function messageModel(value: unknown): string | null {
  const model = messageRecord(value)?.model;
  return typeof model === 'string' && model.trim() ? model : null;
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  const source = gatewayRecord(value);
  if (!source || Object.values(source).some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    return undefined;
  }
  return source as Record<string, number>;
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
  private lastCompactionTsBySession = new Map<string, number>();
  private seenCompactionOperationIds = new Set<string>();
  private seenSessionOperationEvents = new Set<string>();

  // ── Stream micro-batching ──
  // Buffer WebSocket chunks and flush to React every STREAM_FLUSH_MS
  // to reduce re-renders from every event to ~20 FPS max
  private static readonly STREAM_FLUSH_MS = 50;
  private static readonly MAX_RUN_SESSION_BINDINGS = 512;
  private static readonly MAX_SESSION_OPERATION_EVENTS = 512;
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStreams = new Map<string, { id: string; content: string; media?: MediaInfo; runId?: string | null }>();
  private sessionKeyByRunId = new Map<string, string>();
  private transcriptRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recentObservedRunIds = new Map<string, string>();

  constructor(private conn: ChatHandlerConnection) {}

  private rememberSessionOperationEvent(
    sessionKey: string,
    operation: NonNullable<ReturnType<typeof parseOpenClawSessionOperationEvent>>,
  ): boolean {
    const marker = JSON.stringify([
      sessionKey,
      operation.operationId,
      operation.phase,
      operation.ts,
      operation.completed ?? null,
      operation.reason ?? null,
      operation.agentId ?? null,
    ]);
    if (this.seenSessionOperationEvents.has(marker)) return false;
    this.seenSessionOperationEvents.add(marker);
    if (this.seenSessionOperationEvents.size > ChatHandler.MAX_SESSION_OPERATION_EVENTS) {
      const oldest = this.seenSessionOperationEvents.values().next().value;
      if (typeof oldest === 'string') this.seenSessionOperationEvents.delete(oldest);
    }
    return true;
  }

  private injectCompactionDivider(sessionKey: string, operationId?: string): void {
    if (!sessionKey || isIsolatedExecutionSessionKey(sessionKey)) return;
    if (operationId && this.seenCompactionOperationIds.has(operationId)) return;

    const now = Date.now();
    const last = this.lastCompactionTsBySession.get(sessionKey) ?? 0;
    if (now - last <= 10_000) {
      if (operationId) this.seenCompactionOperationIds.add(operationId);
      return;
    }
    this.lastCompactionTsBySession.set(sessionKey, now);
    if (operationId) {
      this.seenCompactionOperationIds.add(operationId);
      if (this.seenCompactionOperationIds.size > 512) {
        const oldest = this.seenCompactionOperationIds.values().next().value;
        if (typeof oldest === 'string') this.seenCompactionOperationIds.delete(oldest);
      }
    }
    if (this.lastCompactionTsBySession.size > 512) {
      const oldest = this.lastCompactionTsBySession.keys().next().value;
      if (typeof oldest === 'string') this.lastCompactionTsBySession.delete(oldest);
    }
    useChatStore.getState().addMessage({
      id: operationId ? `compaction-operation-${operationId}` : `compaction-live-${now}`,
      role: 'compaction',
      content: '',
      timestamp: new Date(now).toISOString(),
    }, sessionKey);
    debugLog('gateway', '[GW] Compaction detected - divider injected');
  }

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

  /** Settle only an exact uncertain delivery confirmed terminal by `agent.wait`. */
  reconcilePendingRunWaitTerminal(
    sessionKey: string,
    runId: string,
    observation: ChatSessionRunObservation,
  ): boolean {
    const normalizedSessionKey = sessionKey.trim();
    const normalizedRunId = runId.trim();
    if (
      !normalizedSessionKey
      || !normalizedRunId
      || !this.isSessionRunObservationCurrent(observation)
    ) {
      return false;
    }
    const pending = this.pendingSends.current(normalizedSessionKey);
    if (pending?.phase !== 'uncertain' || pending.runId !== normalizedRunId) return false;
    const active = this.runProjection.active(normalizedSessionKey);
    if (active && active.runId !== normalizedRunId) return false;

    this.completePendingSend(normalizedSessionKey, normalizedRunId);
    const resolutions = this.runProjection.reconcileSessionSnapshots(
      [{ key: normalizedSessionKey, hasActiveRun: false, activeRunIds: [] }],
      [normalizedSessionKey],
    );
    this.applySessionRunReconciliations(resolutions);
    return resolutions.some((resolution) => resolution.state === 'settled');
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

  /** Apply only the exact run confirmed by OpenClaw's native sessions.abort result. */
  reconcileSessionAbortAcknowledgement(sessionKey: string, response: unknown): boolean {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return false;
    const acknowledgement = classifyOpenClawSessionAbortAcknowledgement(response);
    if (acknowledgement.state !== 'aborted') {
      this.conn.callbacks?.onSessionRunReconciliationNeeded?.(normalizedSessionKey);
      return false;
    }

    const { runId } = acknowledgement;
    const active = this.runProjection.active(normalizedSessionKey);
    if (active && active.runId !== runId) {
      this.conn.callbacks?.onSessionRunReconciliationNeeded?.(normalizedSessionKey);
      return false;
    }
    const pending = this.pendingSends.current(normalizedSessionKey);
    if (!active && pending?.runId !== runId && !this.runProjection.hasActiveSession(normalizedSessionKey)) {
      this.conn.callbacks?.onSessionRunReconciliationNeeded?.(normalizedSessionKey);
      return false;
    }
    const lease = this.claimTerminal(normalizedSessionKey, runId);
    if (!lease) return false;
    const messageId = this.ensureActiveMessageId(normalizedSessionKey, runId);
    const content = this.currentRunIdBySession.get(normalizedSessionKey) === runId
      ? this.currentStreamContentBySession.get(normalizedSessionKey) || ''
      : '';
    this.finalizeAbortedResponse(normalizedSessionKey, messageId, content, lease);
    return true;
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

  private handleChatSendTiming(payload: unknown): void {
    const timing = parseOpenClawChatSendTiming(payload);
    if (!timing || isIsolatedExecutionSessionKey(timing.sessionKey)) return;

    // This event is not a run admission signal. It can be delayed after the
    // official chat.send acknowledgement, so it may only decorate an exact
    // Run already accepted by this projection.
    if (!this.runProjection.active(timing.sessionKey, timing.runId)) return;
    useChatStore.getState().setChatSendTiming(timing.sessionKey, timing);
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

  private getPayloadMessageId(payload: unknown): string {
    const source = gatewayRecord(payload);
    const message = messageRecord(source?.message);
    const data = messageRecord(source?.data);
    const candidateIds = [
      source?.messageId,
      message?.id,
      message?.messageId,
      data?.messageId,
    ];
    return candidateIds.find((value): value is string => typeof value === 'string' && value.trim().length > 0) || '';
  }

  private createSyntheticMessageId(sessionKey: string, runId: string): string {
    const nextSeq = (this.syntheticMessageCounterBySession.get(sessionKey) || 0) + 1;
    this.syntheticMessageCounterBySession.set(sessionKey, nextSeq);
    return `live:${sessionKey}:${runId || 'runless'}:${nextSeq}`;
  }

  private ensureActiveMessageId(sessionKey: string, runId: string, payload?: unknown): string {
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
    const store = useChatStore.getState();
    store.setIsTyping(true, sessionKey);
    store.setChatSendTiming(sessionKey, null);
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
    this.markUnresolvedToolCards(sessionKey, lease.runId);
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

  /** An abort can race a side-effecting tool. Keep its UI state explicitly uncertain. */
  private markUnresolvedToolCards(sessionKey: string, runId: string): void {
    const store = useChatStore.getState();
    const messages = store.getCachedMessages(sessionKey) || [];
    const updated = messages.map((message) => (
      message.role === 'tool' && message.runId === runId && message.toolStatus === 'running'
        ? { ...message, toolStatus: 'verification_required' as const, responseState: 'aborted' as const }
        : message
    ));
    if (updated.some((message, index) => message !== messages[index])) {
      store.setMessages(updated, sessionKey);
    }
  }

  private handleAssistantStream(payload: OpenClawLiveAgentEventPayload) {
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (!sessionKey) return;

    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      debugWarn('gateway', '[GW] Ignoring assistant event without an OpenClaw runId');
      return;
    }
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);
    useChatStore.getState().setChatRunStartup(sessionKey, null);

    const data = payload.data;
    const fullText = typeof data.text === 'string' ? data.text : '';
    const delta = typeof data.delta === 'string' ? data.delta : '';
    const previousSourceText = this.sourceSnapshot(sessionKey, 'agent');
    const nextText = fullText || `${previousSourceText}${delta}`;
    if (!nextText) return;

    // agent 与 chat 是同一 OpenClaw run 的两个投影。文本差异只表示
    // 纠正或传输时序，不能视为消息边界；工具生命周期事件才是明确的
    // 分段边界，并会在上方关闭当前分段。
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

    const liveThinking = extractThinkingContent(
      data.content ?? messageRecord(data.message)?.content,
    );
    if (liveThinking) {
      useChatStore.getState().setThinkingStream(runId, liveThinking, sessionKey);
    }
  }

  private handleLifecycleStream(payload: OpenClawLiveAgentEventPayload) {
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (!sessionKey) return;
    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      debugWarn('gateway', '[GW] Ignoring lifecycle event without an OpenClaw runId');
      return;
    }

    const phase = typeof payload.data.phase === 'string' ? payload.data.phase : '';
    if (phase === 'start') {
      if (!this.beginRun(sessionKey, runId)) return;
      this.bindRunToSession(sessionKey, runId);
      return;
    }

    if (phase !== 'end' && phase !== 'error') return;
    // OpenClaw 在评估供应商回退或重试时会保留普通生命周期错误。生命周期
    // 事件不是 chat 终态，必须由官方会话快照确认归属，不能在客户端虚构
    // 完成超时。
    if (phase === 'error' && payload.data.fallbackExhaustedFailure !== true) return;

    this.forceFlushStream(sessionKey);
    this.conn.callbacks?.onSessionRunReconciliationNeeded?.(sessionKey);
  }

  // 工具流处理：实时展示工具执行。chat 或 agent 事件中的 tool、item 流都
  // 统一投影到会话工具行，不依赖设置页的工具意图显示开关。
  handleToolStream(payload: unknown, source: GatewayToolEventSource = 'tool') {
    const toolEvent = normalizeGatewayToolLifecycleEvent(payload, source);
    if (!toolEvent) return;

    const sessionKey = this.resolveSessionKey(toolEvent.sessionKey, toolEvent.runId);
    const runId = toolEvent.runId ?? '';
    if (!sessionKey || !runId) {
      debugWarn('gateway', '[GW] Ignoring tool event without an OpenClaw sessionKey and runId');
      return;
    }
    const { phase, toolCallId, toolName } = toolEvent;
    const msgId = `tool-live-${runId}-${toolCallId}`;
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);
    const store = useChatStore.getState();
    store.setChatRunStartup(sessionKey, null);
    const listFor = () => store.getCachedMessages(sessionKey) || [];
    const existingToolCard = listFor().find((message) => message.id === msgId);
    const toolCardIsTerminal = existingToolCard?.responseState === 'final'
      || existingToolCard?.toolStatus === 'done'
      || existingToolCard?.toolStatus === 'error'
      || existingToolCard?.toolStatus === 'cancelled'
      || existingToolCard?.toolStatus === 'verification_required';
    // 延迟到达的非终态事件不能把已完成或待核验的工具重新显示为执行中；
    // 后续 result 仍可接收，因为它可能是该状态的权威闭合。
    if (
      phase !== 'result'
      && toolCardIsTerminal
    ) return;
    if (phase === 'start') {
      const currentContent = this.currentStreamContentBySession.get(sessionKey) || '';
      if (currentContent.trim()) {
        this.closeCurrentStreamSegment(sessionKey);
      }
      // 工具开始时幂等写入执行中的卡片。
      const msgs = listFor();
      if (!msgs.some((m) => m.id === msgId)) {
        store.addMessage(
          {
            id: msgId,
            role: 'tool',
            content: '',
            runId,
            toolName,
            toolInput: toolEvent.input ?? {},
            toolStatus: toolEvent.status,
            toolCallId,
            ...(toolEvent.error ? { toolError: toolEvent.error } : {}),
            ...(toolEvent.sourceSequence !== undefined ? { nativeSequence: toolEvent.sourceSequence } : {}),
            responseState: 'streaming',
            timestamp: toolEvent.timestamp,
          },
          sessionKey,
        );
      }
      const timingKey = this.toolTimingKey(sessionKey, runId, toolCallId);
      if (!this.toolStartedAtByKey.has(timingKey)) this.toolStartedAtByKey.set(timingKey, Date.now());
      return;
    }

    if (phase === 'update') {
      // 部分结果流只更新既有卡片。
      const output = projectToolOutput(toolEvent.output);
      const msgs = listFor();
      const idx  = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const updated = [...msgs];
        updated[idx] = {
          ...updated[idx],
          ...(toolEvent.input ? { toolInput: toolEvent.input } : {}),
          ...(output
            ? {
                toolOutput: output.text,
                toolOutputValue: output.truncated ? output.text : toolEvent.output,
                toolOutputTruncated: output.truncated || undefined,
                toolOutputOriginalLength: output.truncated ? output.originalLength : undefined,
              }
            : {}),
          toolStatus: toolEvent.status,
          timestamp: toolEvent.timestamp,
          ...(toolEvent.error ? { toolError: toolEvent.error } : {}),
          ...(toolEvent.sourceSequence !== undefined ? { nativeSequence: toolEvent.sourceSequence } : {}),
        };
        store.setMessages(updated, sessionKey);
      }
      return;
    }

    if (phase === 'result') {
      // 工具完成后以输出和时长闭合卡片。
      const output = projectToolOutput(toolEvent.output);
      const msgs = listFor();
      const idx  = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const updated = [...msgs];
        const timingKey = this.toolTimingKey(sessionKey, runId, toolCallId);
        const startedAt = this.toolStartedAtByKey.get(timingKey);
        this.toolStartedAtByKey.delete(timingKey);
        const durationMs = toolEvent.durationMs
          ?? (startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt));
        updated[idx] = {
          ...updated[idx],
          runId,
          ...(toolEvent.input ? { toolInput: toolEvent.input } : {}),
          ...(output
            ? {
                toolOutput: output.text,
                toolOutputValue: output.truncated ? output.text : toolEvent.output,
                toolOutputTruncated: output.truncated || undefined,
                toolOutputOriginalLength: output.truncated ? output.originalLength : undefined,
              }
            : {}),
          toolStatus: toolEvent.status,
          toolCallId,
          timestamp: toolEvent.timestamp,
          ...(toolEvent.error ? { toolError: toolEvent.error } : {}),
          nativeSequence: toolEvent.sourceSequence ?? updated[idx].nativeSequence,
          responseState: 'final',
          ...(durationMs !== undefined ? { toolDurationMs: durationMs } : {}),
        };
        store.setMessages(updated, sessionKey);
      } else {
        // 未收到 start 事件时，直接补充结果卡片。
        store.addMessage(
          {
            id: msgId,
            role: 'tool',
            content: '',
            runId,
            toolName,
            ...(toolEvent.input ? { toolInput: toolEvent.input } : {}),
            ...(output ? {
              toolOutput: output.text,
              toolOutputValue: output.truncated ? output.text : toolEvent.output,
            } : {}),
            toolStatus: toolEvent.status,
            toolCallId,
            ...(toolEvent.error ? { toolError: toolEvent.error } : {}),
            ...(output?.truncated
              ? { toolOutputTruncated: true, toolOutputOriginalLength: output.originalLength }
              : {}),
            ...(toolEvent.sourceSequence !== undefined ? { nativeSequence: toolEvent.sourceSequence } : {}),
            ...(toolEvent.durationMs !== undefined ? { toolDurationMs: toolEvent.durationMs } : {}),
            responseState: 'final',
            timestamp: toolEvent.timestamp,
          },
          sessionKey,
        );
      }
      return;
    }

    debugLog('gateway', '[GW] Tool stream - unknown phase:', phase, toolCallId);
  }

  // 思考流处理：OpenClaw 通过结构化 agent 流发送推理内容；为兼容协议，
  // chat 分支仍可进入同一投影路径。data.text 是累计内容，data.delta 是新增部分。
  handleThinkingStream(payload: OpenClawLiveAgentEventPayload) {
    const data = payload.data;
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (!sessionKey || !runId) {
      debugWarn('gateway', '[GW] Ignoring thinking event without an OpenClaw sessionKey and runId');
      return;
    }
    if (!this.beginRun(sessionKey, runId)) return;
    this.bindRunToSession(sessionKey, runId);

    const store = useChatStore.getState();
    store.setChatRunStartup(sessionKey, null);
    const previousThinking = store.thinkingBySession[sessionKey]?.text || '';
    const text = typeof data.text === 'string'
      ? data.text
      : typeof data.delta === 'string' && data.delta
        ? `${previousThinking}${data.delta}`
        : '';
    if (!text) return;

    store.setThinkingStream(runId, text, sessionKey);
  }

  /**
   * Gateway 原始事件只能在这里跨越传输边界。运行相关事件先通过官方协议解码，
   * 避免畸形载荷抢占同一 run 的序号并丢弃后续有效事件。
   */
  handleEvent(msg: unknown) {
    const envelope = gatewayRecord(msg);
    const event = typeof envelope?.event === 'string' ? envelope.event : '';
    if (!envelope || envelope.type !== 'event' || !event) {
      debugWarn('gateway', '[GW] Ignoring malformed OpenClaw event envelope');
      return;
    }

    if (event === 'agent' || event === 'chat' || event === 'session.tool') {
      const decoded = parseOpenClawLiveGatewayEvent(msg);
      if (!decoded) {
        debugWarn('gateway', '[GW] Ignoring malformed OpenClaw live run event');
        return;
      }
      if (decoded.kind === 'agent') this.handleLiveAgentEvent(decoded.payload);
      else if (decoded.kind === 'chat') this.handleLiveChatEvent(decoded.payload);
      else this.handleLiveSessionToolEvent(decoded.payload);
      return;
    }

    this.handleNonLiveGatewayEvent(event, envelope.payload);
  }

  /** 仅在完整运行事件通过协议解码后写入同一 run 的序号围栏。 */
  private acceptLiveRunEvent(
    source: 'agent' | 'chat',
    payload: Pick<OpenClawLiveAgentEventPayload, 'runId' | 'seq' | 'sessionKey'>,
    terminal: boolean,
  ): boolean {
    const acceptance = this.runProjection.acceptEvent(source, payload.runId, payload.seq, { terminal });
    if (!acceptance.accepted) return false;
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (acceptance.requiresHistoryRefresh && sessionKey) {
      this.conn.callbacks?.onStreamReconciliationNeeded?.(sessionKey, payload.runId);
    }
    return true;
  }

  /** 投影官方 Agent 流；未被聊天界面消费的流仍交给全局 Gateway 数据层。 */
  private handleLiveAgentEvent(payload: OpenClawLiveAgentEventPayload): void {
    if (!this.acceptLiveRunEvent('agent', payload, false)) return;
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;

    if (payload.stream === 'compaction' && payload.data.phase === 'end' && payload.data.willRetry !== true) {
      if (sessionKey) this.injectCompactionDivider(sessionKey);
      handleGatewayEvent('agent', payload);
      return;
    }
    if (payload.stream === 'assistant') {
      this.handleAssistantStream(payload);
      return;
    }
    if (payload.stream === 'lifecycle') {
      this.handleLifecycleStream(payload);
      return;
    }
    if (payload.stream === 'tool') {
      this.handleToolStream(payload);
      return;
    }
    if (payload.stream === 'thinking') {
      this.handleThinkingStream(payload);
      return;
    }
    if (payload.stream === 'item' && payload.data.kind === 'tool') {
      this.handleToolStream(payload, 'item');
      return;
    }
    handleGatewayEvent('agent', payload);
  }

  /** `session.tool` 与 Agent 工具流共用官方 run 序号，不能重复渲染。 */
  private handleLiveSessionToolEvent(payload: OpenClawLiveAgentEventPayload): void {
    if (!this.acceptLiveRunEvent('agent', payload, false)) return;
    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (sessionKey && isIsolatedExecutionSessionKey(sessionKey)) return;
    this.handleToolStream(payload);
  }

  /** 投影官方 ChatEventSchema 的五种状态，不再解释已移除的自定义流字段。 */
  private handleLiveChatEvent(payload: OpenClawLiveChatEventPayload): void {
    const terminal = payload.state === 'final' || payload.state === 'error' || payload.state === 'aborted';
    if (!this.acceptLiveRunEvent('chat', payload, terminal)) return;

    const sessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (!sessionKey || isIsolatedExecutionSessionKey(sessionKey)) return;
    this.bindRunToSession(sessionKey, payload.runId);

    if (payload.state === 'status') {
      if (!this.beginRun(sessionKey, payload.runId)) return;
      useChatStore.getState().setChatRunStartup(sessionKey, {
        runId: payload.runId,
        phase: payload.phase,
      });
      return;
    }

    const snapshotText = payload.message === undefined || payload.message === null
      ? null
      : extractText(messageContent(payload.message));
    const messageText = payload.state === 'delta'
      ? resolveOpenClawChatDeltaText(this.sourceSnapshot(sessionKey, 'chat') || null, {
          deltaText: payload.deltaText,
          replace: payload.replace,
          snapshotText,
        }) ?? ''
      : snapshotText ?? '';
    const media = messageMedia(payload.message);

    debugLog(
      'gateway',
      '[GW] Chat event — state:',
      payload.state,
      'runId:',
      payload.runId.substring(0, 12),
      'text length:',
      messageText.length,
      'text preview:',
      messageText.substring(0, 80),
    );

    if (payload.state === 'delta') {
      if (!this.beginRun(sessionKey, payload.runId)) return;
      useChatStore.getState().setChatRunStartup(sessionKey, null);
      const messageId = this.ensureActiveMessageId(sessionKey, payload.runId, payload);
      if (!messageText && !media) return;
      const selectedText = this.updateStreamSnapshot(sessionKey, 'chat', messageText, true);
      this.currentStreamContentBySession.set(sessionKey, selectedText);
      this.currentRunIdBySession.set(sessionKey, payload.runId);
      const segmentText = this.getSegmentText(sessionKey, selectedText);
      this.bufferStreamChunk(
        sessionKey,
        messageId,
        this.getDisplayStreamText(segmentText),
        media,
        payload.runId,
      );
      const liveThinkingFromBlocks = extractThinkingContent(messageContent(payload.message));
      if (liveThinkingFromBlocks) {
        useChatStore.getState().setThinkingStream(payload.runId, liveThinkingFromBlocks, sessionKey);
      }
      return;
    }

    if (payload.state === 'final') {
      const lease = this.claimTerminal(sessionKey, payload.runId);
      if (!lease) return;
      const messageId = this.ensureActiveMessageId(sessionKey, payload.runId, payload);
      const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
      const streamContent = !activeRunId || activeRunId === payload.runId
        ? (this.currentStreamContentBySession.get(sessionKey) || '')
        : '';
      const finalText = payload.message === undefined || payload.message === null
        ? streamContent
        : messageText;
      const message = messageRecord(payload.message);
      const usage = numericRecord(payload.usage) ?? numericRecord(message?.usage);
      this.finalizeAssistantResponse(
        sessionKey,
        messageId,
        finalText,
        lease,
        media,
        usage,
        messageModel(payload.message),
      );
      return;
    }

    if (payload.state === 'error') {
      const lease = this.claimTerminal(sessionKey, payload.runId);
      if (!lease) return;
      const messageId = this.ensureActiveMessageId(sessionKey, payload.runId, payload);
      this.finalizeErroredResponse(
        sessionKey,
        messageId,
        payload.errorMessage || i18n.t('errors.occurred'),
        lease,
      );
      return;
    }

    const lease = this.claimTerminal(sessionKey, payload.runId);
    if (!lease) return;
    const messageId = this.ensureActiveMessageId(sessionKey, payload.runId, payload);
    const activeRunId = this.currentRunIdBySession.get(sessionKey) || '';
    const currentText = this.currentStreamContentBySession.get(sessionKey) || '';
    const finalContent = messageText || (!activeRunId || activeRunId === payload.runId ? currentText : '');
    this.finalizeAbortedResponse(sessionKey, messageId, finalContent, lease);
  }

  /** 会话转录是独立事件，先按该事件的显式字段核验再触发历史刷新。 */
  private handleSessionMessageEvent(payload: Record<string, unknown>): void {
    const transcriptSessionKey = this.resolveSessionKey(payload.sessionKey, payload.runId);
    if (!transcriptSessionKey || isIsolatedExecutionSessionKey(transcriptSessionKey)) return;
    if (!this.runProjection.acceptTranscriptUpdate(transcriptSessionKey, payload.messageSeq)) return;

    let settledBySnapshot = false;
    const activeRun = this.runProjection.active(transcriptSessionKey);
    const hasAnonymousActiveRun = !activeRun && this.runProjection.hasActiveSession(transcriptSessionKey);
    const transcriptMessage = messageRecord(payload.message);
    const transcriptRole = typeof transcriptMessage?.role === 'string' ? transcriptMessage.role : '';
    const transcriptEventRunId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    const transcriptIdentity = readGatewayMessageIdentity(payload.message);
    const transcriptRunId = transcriptEventRunId || transcriptIdentity.clientMessageId || '';
    this.conn.callbacks?.onTranscriptMessage?.({ sessionKey: transcriptSessionKey, role: transcriptRole });

    const transcriptSettlesActiveRun = Boolean(
      activeRun && transcriptRole === 'assistant' && transcriptRunId === activeRun.runId,
    );
    const shouldReconcileSnapshot = payload.hasActiveRun === true
      || (payload.hasActiveRun === false && (hasAnonymousActiveRun || transcriptSettlesActiveRun));
    if (shouldReconcileSnapshot) {
      const snapshots = [{ ...payload, key: transcriptSessionKey }];
      const resolutions = this.runProjection.reconcileSessionSnapshots(snapshots, [transcriptSessionKey]);
      this.completePendingSendsFromSnapshots(snapshots, resolutions);
      settledBySnapshot = resolutions.some((resolution) => resolution.state === 'settled');
      if (settledBySnapshot) this.clearTranscriptRefresh(transcriptSessionKey);
      this.applySessionRunReconciliations(resolutions);
    } else if (
      payload.hasActiveRun === false
      && (activeRun || useChatStore.getState().typingBySession[transcriptSessionKey])
    ) {
      this.conn.callbacks?.onSessionRunReconciliationNeeded?.(transcriptSessionKey);
    }
    if (!settledBySnapshot) this.scheduleTranscriptRefresh(transcriptSessionKey);
  }

  /** 非实时事件保持各自的官方解码器或失效刷新逻辑，不进入运行序号围栏。 */
  private handleNonLiveGatewayEvent(event: string, payload: unknown): void {
    if (event === 'chat.send_timing') {
      this.handleChatSendTiming(payload);
      return;
    }
    if (event === 'session.operation') {
      const operation = parseOpenClawSessionOperationEvent(payload);
      if (!operation) {
        debugWarn('gateway', '[GW] Ignoring malformed OpenClaw session.operation event');
        return;
      }
      const sessionKey = this.resolveSessionKey(operation.sessionKey);
      if (!sessionKey || isIsolatedExecutionSessionKey(sessionKey)) return;
      if (!this.rememberSessionOperationEvent(sessionKey, operation)) return;
      const store = useChatStore.getState();
      const current = store.compactionStatusBySession[sessionKey];
      if (operation.phase === 'start') {
        store.setCompactionStatus(sessionKey, {
          operationId: operation.operationId,
          phase: 'active',
          startedAt: operation.ts,
        });
        return;
      }
      if (current && current.operationId !== operation.operationId) return;
      if (operation.completed === true) this.injectCompactionDivider(sessionKey, operation.operationId);
      store.setCompactionStatus(sessionKey, null);
      return;
    }
    if (event === 'session.message') {
      const record = gatewayRecord(payload);
      if (!record) {
        debugWarn('gateway', '[GW] Ignoring malformed OpenClaw session.message event');
        return;
      }
      this.handleSessionMessageEvent(record);
      return;
    }
    handleGatewayEvent(event, payload);
  }
}
