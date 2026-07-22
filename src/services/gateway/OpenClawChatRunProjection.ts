import {
  SessionRunFence,
  type SessionRunLease,
  type SessionRunStart,
} from './SessionRunFence';

export type OpenClawRunEventSource = 'agent' | 'chat';
export type OpenClawRunLease = SessionRunLease;
export type OpenClawRunStart = SessionRunStart;

export interface OpenClawRunEventAcceptance {
  accepted: boolean;
  requiresHistoryRefresh: boolean;
}

export interface OpenClawRunEventDescriptor {
  /** Terminal chat events may legally reuse the last delta sequence. */
  terminal?: boolean;
}

export type OpenClawChatSendAcknowledgement =
  | { state: 'active'; runId: string }
  | { state: 'settled'; runId: string }
  | { state: 'unknown' };

export type OpenClawChatAbortAcknowledgement =
  | { state: 'aborted'; runIds: string[] }
  | { state: 'not_aborted'; runIds: [] }
  | { state: 'unknown'; runIds: [] };

export interface OpenClawSessionListSnapshot {
  sessions: unknown[];
  complete: boolean;
}

export interface OpenClawInFlightRunSnapshot {
  runId: string;
  text: string;
  plan?: unknown;
}

const ACTIVE_CHAT_SEND_STATUSES = new Set(['started', 'in_flight']);
const SETTLED_CHAT_SEND_STATUSES = new Set(['ok', 'timeout']);

/**
 * Classify the response to OpenClaw's idempotent `chat.send` RPC.
 *
 * A retried request can report an already-running or already-terminal turn.
 * The run id must still equal the submitted idempotency key before the response
 * is allowed to mutate this renderer's run projection.
 */
export function classifyOpenClawChatSendAcknowledgement(
  response: unknown,
  expectedRunId: string,
): OpenClawChatSendAcknowledgement {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { state: 'unknown' };
  }
  const record = response as Record<string, unknown>;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  const status = typeof record.status === 'string' ? record.status.trim() : '';
  if (!runId || runId !== expectedRunId.trim()) return { state: 'unknown' };
  if (ACTIVE_CHAT_SEND_STATUSES.has(status)) return { state: 'active', runId };
  if (SETTLED_CHAT_SEND_STATUSES.has(status)) return { state: 'settled', runId };
  return { state: 'unknown' };
}

/** Classify OpenClaw's official `chat.abort` result without inferring success. */
export function classifyOpenClawChatAbortAcknowledgement(
  response: unknown,
): OpenClawChatAbortAcknowledgement {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { state: 'unknown', runIds: [] };
  }
  const record = response as Record<string, unknown>;
  if (record.ok !== true || typeof record.aborted !== 'boolean' || !Array.isArray(record.runIds)) {
    return { state: 'unknown', runIds: [] };
  }
  const runIds = [...new Set(record.runIds.flatMap((runId) => {
    const normalized = typeof runId === 'string' ? runId.trim() : '';
    return normalized ? [normalized] : [];
  }))];
  if (!record.aborted) return { state: 'not_aborted', runIds: [] };
  return runIds.length > 0
    ? { state: 'aborted', runIds }
    : { state: 'unknown', runIds: [] };
}

/** Preserve the pagination proof attached to an OpenClaw sessions.list result. */
export function parseOpenClawSessionListSnapshot(response: unknown): OpenClawSessionListSnapshot {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { sessions: [], complete: false };
  }
  const record = response as Record<string, unknown>;
  const hasSessionsArray = Array.isArray(record.sessions);
  const sessions = hasSessionsArray ? record.sessions as unknown[] : [];
  if (!hasSessionsArray) return { sessions, complete: false };
  if (record.hasMore === false) return { sessions, complete: true };
  if (record.hasMore === true) return { sessions, complete: false };

  const totalCount = typeof record.totalCount === 'number' && Number.isSafeInteger(record.totalCount)
    ? record.totalCount
    : null;
  const offset = typeof record.offset === 'number' && Number.isSafeInteger(record.offset) && record.offset >= 0
    ? record.offset
    : null;
  return {
    sessions,
    complete: totalCount !== null
      && totalCount >= 0
      && offset !== null
      && offset + sessions.length >= totalCount,
  };
}

/** Parse the documented `chat.history.inFlightRun` recovery projection. */
export function parseOpenClawInFlightRunSnapshot(
  response: unknown,
): OpenClawInFlightRunSnapshot | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const raw = (response as Record<string, unknown>).inFlightRun;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  if (!runId || typeof record.text !== 'string') return null;
  return {
    runId,
    text: record.text,
    ...(Object.prototype.hasOwnProperty.call(record, 'plan') ? { plan: record.plan } : {}),
  };
}

export interface OpenClawSessionRunReconciliation {
  sessionKey: string;
  state: 'active' | 'settled';
  activeRunIds: string[];
  activeRunId?: string;
  replacedRunId?: string;
}

export interface OpenClawSessionReconciliationOptions {
  settleMissing?: boolean;
}

interface SessionRunSnapshot {
  sessionKey: string;
  hasActiveRun: boolean;
  activeRunIds: string[];
}

const MAX_TRACKED_SEQUENCES = 512;

/**
 * Protocol adapter for the OpenClaw live-run contract.
 *
 * It owns run identity, per-source sequence monotonicity and the authoritative
 * `sessions.list` reconciliation surface. UI code must only consume the
 * decisions it returns; task and presentation metadata must not mutate run
 * state outside this projection.
 */
export class OpenClawChatRunProjection {
  private readonly fence = new SessionRunFence();
  private readonly anonymousActiveSessions = new Set<string>();
  private readonly sequenceBySource: Record<OpenClawRunEventSource, Map<string, number>> = {
    agent: new Map(),
    chat: new Map(),
  };
  private readonly terminalSequenceBySource: Record<OpenClawRunEventSource, Map<string, number>> = {
    agent: new Map(),
    chat: new Map(),
  };
  private readonly lastHistoryRefreshSequenceByRunId = new Map<string, number>();
  private readonly transcriptSequenceBySession = new Map<string, number>();

  acceptEvent(
    source: OpenClawRunEventSource,
    runId: unknown,
    sequence: unknown,
    descriptor: OpenClawRunEventDescriptor = {},
  ): OpenClawRunEventAcceptance {
    if (typeof runId !== 'string' || !runId.trim()) {
      return { accepted: true, requiresHistoryRefresh: false };
    }
    if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) {
      return { accepted: true, requiresHistoryRefresh: false };
    }

    const acceptedByRunId = this.sequenceBySource[source];
    const previous = acceptedByRunId.get(runId);
    if (previous !== undefined && sequence <= previous) {
      const terminalAtSequence = this.terminalSequenceBySource[source].get(runId);
      const isTerminalAfterLastDelta = descriptor.terminal === true
        && sequence === previous
        && terminalAtSequence !== sequence;
      if (!isTerminalAfterLastDelta) {
        return { accepted: false, requiresHistoryRefresh: false };
      }
    }
    this.rememberSequence(acceptedByRunId, runId, sequence);

    if (descriptor.terminal === true) {
      this.rememberSequence(this.terminalSequenceBySource[source], runId, sequence);
    }

    // `agent.seq` is the complete run event sequence. `chat.seq` is a sparse
    // text projection and legitimately jumps over tool/reasoning events.
    const hasAgentGap = source === 'agent'
      && previous !== undefined
      && sequence > previous + 1
      && this.lastHistoryRefreshSequenceByRunId.get(runId) !== sequence;
    const requiresHistoryRefresh = hasAgentGap;
    if (requiresHistoryRefresh) {
      this.rememberSequence(this.lastHistoryRefreshSequenceByRunId, runId, sequence);
    }
    return { accepted: true, requiresHistoryRefresh };
  }

  /**
   * `session.message` is the durable transcript notification emitted by
   * OpenClaw. Message sequence numbers are per session, not per run.
   */
  acceptTranscriptUpdate(sessionKey: string, messageSeq: unknown): boolean {
    const sequence = typeof messageSeq === 'number' && Number.isSafeInteger(messageSeq) && messageSeq > 0
      ? messageSeq
      : null;
    if (sequence === null) return true;
    const previous = this.transcriptSequenceBySession.get(sessionKey);
    if (previous !== undefined && sequence <= previous) return false;
    this.rememberSequence(this.transcriptSequenceBySession, sessionKey, sequence);
    return true;
  }

  begin(sessionKey: string, runId: string): OpenClawRunStart | null {
    this.anonymousActiveSessions.delete(sessionKey);
    return this.fence.begin(sessionKey, runId);
  }

  claimTerminal(sessionKey: string, runId: string): OpenClawRunLease | null {
    const lease = this.fence.claimTerminal(sessionKey, runId);
    if (lease) this.anonymousActiveSessions.delete(sessionKey);
    return lease;
  }

  active(sessionKey: string, runId?: string): OpenClawRunLease | null {
    return this.fence.active(sessionKey, runId);
  }

  complete(lease: OpenClawRunLease): boolean {
    const completed = this.fence.complete(lease);
    if (completed) this.anonymousActiveSessions.delete(lease.sessionKey);
    return completed;
  }

  invalidate(sessionKey: string): void {
    this.anonymousActiveSessions.delete(sessionKey);
    this.transcriptSequenceBySession.delete(sessionKey);
    this.fence.invalidate(sessionKey);
  }

  activeSessionKeys(): string[] {
    return [...new Set([
      ...this.fence.activeSessionKeys(),
      ...this.anonymousActiveSessions,
    ])];
  }

  hasActiveSession(sessionKey: string): boolean {
    return Boolean(this.fence.active(sessionKey)) || this.anonymousActiveSessions.has(sessionKey);
  }

  /** Adopt the exact run id from `chat.history.inFlightRun`. */
  adoptInFlightRun(sessionKey: string, runId: string): OpenClawSessionRunReconciliation {
    this.anonymousActiveSessions.delete(sessionKey);
    const adopted = this.fence.adopt(sessionKey, runId);
    return {
      sessionKey,
      state: 'active',
      activeRunIds: [runId],
      activeRunId: adopted.lease.runId,
      ...(adopted.replacedRunId ? { replacedRunId: adopted.replacedRunId } : {}),
    };
  }

  reconcileSessionSnapshots(
    sessions: unknown[],
    pendingSessionKeys: Iterable<string>,
    options: OpenClawSessionReconciliationOptions = {},
  ): OpenClawSessionRunReconciliation[] {
    const snapshots = this.snapshotBySession(sessions);
    const observedSessionKeys = new Set(
      sessions.flatMap((raw) => {
        const sessionKey = this.readSessionKey(raw);
        return sessionKey ? [sessionKey] : [];
      }),
    );

    // A run can be created outside this renderer (another client, a channel,
    // or a restored Gateway). It must still enter the same authoritative
    // projection before the user can send another turn in that session.
    const sessionKeys = new Set(pendingSessionKeys);
    for (const snapshot of snapshots.values()) {
      if (snapshot.hasActiveRun) sessionKeys.add(snapshot.sessionKey);
    }

    const decisions: OpenClawSessionRunReconciliation[] = [];
    for (const sessionKey of sessionKeys) {
      const snapshot = snapshots.get(sessionKey);
      if (!snapshot) {
        // Older gateways can return the row without live-run fields. That is
        // unknown state, not evidence that the session or run disappeared.
        if (observedSessionKeys.has(sessionKey)) continue;
        if (!options.settleMissing) continue;
        const active = this.fence.active(sessionKey);
        if (active) this.fence.complete(active);
        this.anonymousActiveSessions.delete(sessionKey);
        decisions.push({ sessionKey, state: 'settled', activeRunIds: [] });
        continue;
      }
      if (snapshot.hasActiveRun) {
        const decision = this.reconcileActiveSnapshot(snapshot, true);
        if (decision) decisions.push(decision);
        continue;
      }
      const active = this.fence.active(sessionKey);
      if (active) this.fence.complete(active);
      this.anonymousActiveSessions.delete(sessionKey);
      decisions.push({ sessionKey, state: 'settled', activeRunIds: [] });
    }
    return decisions;
  }

  unresolvedSessionKeys(
    sessions: unknown[],
    pendingSessionKeys: Iterable<string>,
    options: OpenClawSessionReconciliationOptions = {},
  ): string[] {
    const snapshotSessionKeys = new Set(this.snapshotBySession(sessions).keys());
    const observedSessionKeys = new Set(
      sessions.flatMap((raw) => {
        const sessionKey = this.readSessionKey(raw);
        return sessionKey ? [sessionKey] : [];
      }),
    );
    return [...new Set(pendingSessionKeys)].filter((sessionKey) => {
      if (snapshotSessionKeys.has(sessionKey)) return false;
      if (options.settleMissing && !observedSessionKeys.has(sessionKey)) return false;
      return true;
    });
  }

  /**
   * Fold newly observed Gateway activity into the local projection without
   * allowing an ordinary, possibly older list response to settle or replace a
   * locally live run. Full replacement and settlement belong to reconnect
   * reconciliation above.
   */
  observeActiveSessionSnapshots(sessions: unknown[]): OpenClawSessionRunReconciliation[] {
    const decisions: OpenClawSessionRunReconciliation[] = [];
    for (const snapshot of this.snapshotBySession(sessions).values()) {
      if (!snapshot.hasActiveRun) continue;
      const decision = this.reconcileActiveSnapshot(snapshot, false);
      if (decision) decisions.push(decision);
    }
    return decisions;
  }

  private reconcileActiveSnapshot(
    snapshot: SessionRunSnapshot,
    allowReplacingCurrentRun: boolean,
  ): OpenClawSessionRunReconciliation | null {
    const current = this.fence.active(snapshot.sessionKey);
    let activeRunId: string | undefined;
    let replacedRunId: string | undefined;

    if (snapshot.activeRunIds.length === 0) {
      // OpenClaw documents that a true hasActiveRun without an exact run-id
      // membership can describe another runtime projection. Authoritative
      // reconciliation must therefore release a retained local lease; an
      // ordinary refresh remains observational and keeps it until stronger
      // evidence arrives.
      if (!allowReplacingCurrentRun && current) {
        activeRunId = current.runId;
      } else if (allowReplacingCurrentRun) {
        if (current && this.fence.complete(current)) replacedRunId = current.runId;
        this.anonymousActiveSessions.add(snapshot.sessionKey);
      } else if (!this.anonymousActiveSessions.has(snapshot.sessionKey)) {
        return null;
      }
    } else if (current && snapshot.activeRunIds.includes(current.runId)) {
      activeRunId = current.runId;
    } else if (current && !allowReplacingCurrentRun) {
      activeRunId = current.runId;
    } else {
      this.anonymousActiveSessions.delete(snapshot.sessionKey);
      const adopted = this.adoptSnapshotRun(snapshot);
      if (adopted) {
        activeRunId = adopted.lease.runId;
        replacedRunId = adopted.replacedRunId ?? undefined;
      } else if (allowReplacingCurrentRun) {
        if (current && this.fence.complete(current)) replacedRunId = current.runId;
        this.anonymousActiveSessions.add(snapshot.sessionKey);
      } else {
        // An ordinary refresh cannot resurrect an already-terminal run.
        return null;
      }
    }

    return {
      sessionKey: snapshot.sessionKey,
      state: 'active',
      activeRunIds: snapshot.activeRunIds,
      ...(activeRunId ? { activeRunId } : {}),
      ...(replacedRunId ? { replacedRunId } : {}),
    };
  }

  private adoptSnapshotRun(snapshot: SessionRunSnapshot): SessionRunStart | null {
    for (const runId of snapshot.activeRunIds) {
      const adopted = this.fence.begin(snapshot.sessionKey, runId);
      if (adopted) return adopted;
    }
    return null;
  }

  private snapshotBySession(sessions: unknown[]): Map<string, SessionRunSnapshot> {
    const snapshots = new Map<string, SessionRunSnapshot>();
    for (const raw of sessions) {
      const snapshot = this.parseSessionRunSnapshot(raw);
      if (snapshot) snapshots.set(snapshot.sessionKey, snapshot);
    }
    return snapshots;
  }

  private parseSessionRunSnapshot(raw: unknown): SessionRunSnapshot | null {
    const sessionKey = this.readSessionKey(raw);
    if (!sessionKey || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.hasActiveRun !== 'boolean') return null;
    const activeRunIds = Array.isArray(row.activeRunIds)
      ? [...new Set(row.activeRunIds.flatMap((runId) => {
          const normalized = typeof runId === 'string' ? runId.trim() : '';
          return normalized ? [normalized] : [];
        }))]
      : [];
    return { sessionKey, hasActiveRun: row.hasActiveRun, activeRunIds };
  }

  private readSessionKey(raw: unknown): string {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
    const row = raw as Record<string, unknown>;
    return typeof row.key === 'string'
      ? row.key.trim()
      : typeof row.sessionKey === 'string'
        ? row.sessionKey.trim()
        : '';
  }

  private rememberSequence<T>(target: Map<string, T>, key: string, value: T): void {
    target.delete(key);
    target.set(key, value);
    while (target.size > MAX_TRACKED_SEQUENCES) {
      const oldest = target.keys().next().value;
      if (oldest === undefined) break;
      target.delete(oldest);
    }
  }
}
