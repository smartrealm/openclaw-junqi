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

export interface OpenClawSessionRunReconciliation {
  sessionKey: string;
  state: 'active' | 'settled';
  activeRunIds: string[];
  activeRunId?: string;
  replacedRunId?: string;
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
 * decisions it returns; it must not infer terminal state from lifecycle or
 * task-status events.
 */
export class OpenClawChatRunProjection {
  private readonly fence = new SessionRunFence();
  private readonly sequenceBySource: Record<OpenClawRunEventSource, Map<string, number>> = {
    agent: new Map(),
    chat: new Map(),
  };
  private readonly historyRefreshRequestedByRunId = new Map<string, true>();
  private readonly transcriptSequenceBySession = new Map<string, number>();

  acceptEvent(
    source: OpenClawRunEventSource,
    runId: unknown,
    sequence: unknown,
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
      return { accepted: false, requiresHistoryRefresh: false };
    }
    this.rememberSequence(acceptedByRunId, runId, sequence);

    const requiresHistoryRefresh = previous !== undefined
      && sequence > previous + 1
      && !this.historyRefreshRequestedByRunId.has(runId);
    if (requiresHistoryRefresh) this.rememberSequence(this.historyRefreshRequestedByRunId, runId, true);
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
    return this.fence.begin(sessionKey, runId);
  }

  claimTerminal(sessionKey: string, runId: string): OpenClawRunLease | null {
    return this.fence.claimTerminal(sessionKey, runId);
  }

  active(sessionKey: string, runId?: string): OpenClawRunLease | null {
    return this.fence.active(sessionKey, runId);
  }

  complete(lease: OpenClawRunLease): boolean {
    return this.fence.complete(lease);
  }

  invalidate(sessionKey: string): void {
    this.fence.invalidate(sessionKey);
  }

  activeSessionKeys(): string[] {
    return this.fence.activeSessionKeys();
  }

  reconcileSessionSnapshots(
    sessions: unknown[],
    pendingSessionKeys: Iterable<string>,
  ): OpenClawSessionRunReconciliation[] {
    const snapshots = this.snapshotBySession(sessions);

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
      if (!snapshot) continue;
      if (snapshot.hasActiveRun) {
        decisions.push(this.reconcileActiveSnapshot(snapshot, true));
        continue;
      }
      const active = this.fence.active(sessionKey);
      if (active) this.fence.complete(active);
      decisions.push({ sessionKey, state: 'settled', activeRunIds: [] });
    }
    return decisions;
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
      if (snapshot.hasActiveRun) decisions.push(this.reconcileActiveSnapshot(snapshot, false));
    }
    return decisions;
  }

  private reconcileActiveSnapshot(
    snapshot: SessionRunSnapshot,
    allowReplacingCurrentRun: boolean,
  ): OpenClawSessionRunReconciliation {
    const current = this.fence.active(snapshot.sessionKey);
    let activeRunId: string | undefined;
    let replacedRunId: string | undefined;

    if (snapshot.activeRunIds.length === 0) {
      // A true flag without identities can represent another OpenClaw
      // projection. During reconnect, retire an old local identity so it
      // cannot claim future terminal events. During ordinary refresh, keep a
      // current local lease until a stronger observation arrives.
      if (current && allowReplacingCurrentRun) {
        replacedRunId = current.runId;
        this.fence.invalidate(snapshot.sessionKey);
      } else if (current) {
        activeRunId = current.runId;
      }
    } else if (current && snapshot.activeRunIds.includes(current.runId)) {
      activeRunId = current.runId;
    } else if (current && !allowReplacingCurrentRun) {
      activeRunId = current.runId;
    } else {
      const adopted = this.fence.begin(snapshot.sessionKey, snapshot.activeRunIds[0]);
      if (adopted) {
        activeRunId = adopted.lease.runId;
        replacedRunId = adopted.replacedRunId ?? undefined;
      } else if (current && allowReplacingCurrentRun) {
        replacedRunId = current.runId;
        this.fence.invalidate(snapshot.sessionKey);
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

  private snapshotBySession(sessions: unknown[]): Map<string, SessionRunSnapshot> {
    const snapshots = new Map<string, SessionRunSnapshot>();
    for (const raw of sessions) {
      const snapshot = this.parseSessionRunSnapshot(raw);
      if (snapshot) snapshots.set(snapshot.sessionKey, snapshot);
    }
    return snapshots;
  }

  private parseSessionRunSnapshot(raw: unknown): SessionRunSnapshot | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const sessionKey = typeof row.key === 'string'
      ? row.key.trim()
      : typeof row.sessionKey === 'string'
        ? row.sessionKey.trim()
        : '';
    if (!sessionKey || typeof row.hasActiveRun !== 'boolean') return null;
    const activeRunIds = Array.isArray(row.activeRunIds)
      ? [...new Set(row.activeRunIds.flatMap((runId) => {
          const normalized = typeof runId === 'string' ? runId.trim() : '';
          return normalized ? [normalized] : [];
        }))]
      : [];
    return { sessionKey, hasActiveRun: row.hasActiveRun, activeRunIds };
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
