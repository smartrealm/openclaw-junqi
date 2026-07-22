export interface SessionRunLease {
  sessionKey: string;
  runId: string;
  generation: number;
}

export interface SessionRunStart {
  lease: SessionRunLease;
  replacedRunId: string | null;
}

interface SessionRunState {
  generation: number;
  activeRunId: string | null;
  retiredRunIds: string[];
}

const MAX_RETIRED_RUN_IDS = 16;

/**
 * Owns the protocol authority for a single session's streamed response.
 *
 * Gateway events may arrive late, be repeated, or race with a session reset.
 * Callers receive a lease when a run becomes active and can later prove that a
 * terminal event still belongs to that run before changing local state.
 */
export class SessionRunFence {
  private readonly sessions = new Map<string, SessionRunState>();

  begin(sessionKey: string, runId: string): SessionRunStart | null {
    const state = this.stateFor(sessionKey);
    if (state.activeRunId === runId) {
      return { lease: this.lease(sessionKey, runId, state), replacedRunId: null };
    }
    if (state.retiredRunIds.includes(runId)) return null;

    const replacedRunId = state.activeRunId;
    if (replacedRunId) this.retire(state, replacedRunId);

    state.generation += 1;
    state.activeRunId = runId;
    return { lease: this.lease(sessionKey, runId, state), replacedRunId };
  }

  /**
   * Adopt a run from an authoritative OpenClaw snapshot.
   *
   * Transport invalidation retires run ids so delayed frames cannot resurrect
   * them. A later `chat.history.inFlightRun` or exact `activeRunIds` snapshot is
   * stronger evidence and may explicitly revive that same id.
   */
  adopt(sessionKey: string, runId: string): SessionRunStart {
    const state = this.stateFor(sessionKey);
    if (state.activeRunId === runId) {
      return { lease: this.lease(sessionKey, runId, state), replacedRunId: null };
    }

    const replacedRunId = state.activeRunId;
    if (replacedRunId) this.retire(state, replacedRunId);
    state.retiredRunIds = state.retiredRunIds.filter((retiredRunId) => retiredRunId !== runId);
    state.generation += 1;
    state.activeRunId = runId;
    return { lease: this.lease(sessionKey, runId, state), replacedRunId };
  }

  /** Claims a terminal event without allowing it to overwrite a newer run. */
  claimTerminal(sessionKey: string, runId: string): SessionRunLease | null {
    const state = this.stateFor(sessionKey);
    if (state.retiredRunIds.includes(runId)) return null;
    if (state.activeRunId && state.activeRunId !== runId) return null;
    if (!state.activeRunId) return this.begin(sessionKey, runId)?.lease ?? null;
    return this.lease(sessionKey, runId, state);
  }

  active(sessionKey: string, runId?: string): SessionRunLease | null {
    const state = this.sessions.get(sessionKey);
    if (!state?.activeRunId) return null;
    if (runId && state.activeRunId !== runId) return null;
    return this.lease(sessionKey, state.activeRunId, state);
  }

  activeSessionKeys(): string[] {
    return [...this.sessions]
      .filter(([, state]) => state.activeRunId !== null)
      .map(([sessionKey]) => sessionKey);
  }

  complete(lease: SessionRunLease): boolean {
    const state = this.sessions.get(lease.sessionKey);
    if (!state || state.generation !== lease.generation || state.activeRunId !== lease.runId) {
      return false;
    }
    state.activeRunId = null;
    this.retire(state, lease.runId);
    return true;
  }

  completeActive(sessionKey: string): SessionRunLease | null {
    const lease = this.active(sessionKey);
    if (!lease || !this.complete(lease)) return null;
    return lease;
  }

  invalidate(sessionKey: string): void {
    const state = this.stateFor(sessionKey);
    if (state.activeRunId) this.retire(state, state.activeRunId);
    state.generation += 1;
    state.activeRunId = null;
  }

  invalidateAll(): void {
    for (const sessionKey of this.sessions.keys()) this.invalidate(sessionKey);
  }

  private stateFor(sessionKey: string): SessionRunState {
    let state = this.sessions.get(sessionKey);
    if (!state) {
      state = { generation: 0, activeRunId: null, retiredRunIds: [] };
      this.sessions.set(sessionKey, state);
    }
    return state;
  }

  private lease(sessionKey: string, runId: string, state: SessionRunState): SessionRunLease {
    return { sessionKey, runId, generation: state.generation };
  }

  private retire(state: SessionRunState, runId: string): void {
    if (state.retiredRunIds.includes(runId)) return;
    state.retiredRunIds.push(runId);
    if (state.retiredRunIds.length > MAX_RETIRED_RUN_IDS) state.retiredRunIds.shift();
  }
}
