import type { OpenClawAgentWaitResult } from './OpenClawAgentWaitClient';
import type { OpenClawPendingChatSendPhase } from './OpenClawPendingChatSend';

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

export interface OpenClawPendingRunWaitReconcilerDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  checkRunForConnection: (runId: string, connectionId: string) => Promise<OpenClawAgentWaitResult>;
  captureObservation: (sessionKey: string) => ChatSessionRunObservation;
  isObservationCurrent: (observation: ChatSessionRunObservation) => boolean;
  applyTerminal: (sessionKey: string, runId: string, observation: ChatSessionRunObservation) => boolean;
  onError?: (sessionKey: string, error: unknown) => void;
}

interface InFlightEntry {
  promise: Promise<boolean>;
  rerunRequested: boolean;
}

/**
 * Resolves only a renderer-recorded uncertain delivery by querying the same
 * Gateway run id. History remains responsible for durable transcript content.
 */
export class OpenClawPendingRunWaitReconciler {
  private readonly inFlightBySession = new Map<string, InFlightEntry>();

  constructor(private readonly dependencies: OpenClawPendingRunWaitReconcilerDependencies) {}

  reconcile(sessionKey: string): Promise<boolean> {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return Promise.resolve(false);
    const existing = this.inFlightBySession.get(normalizedSessionKey);
    if (existing) {
      existing.rerunRequested = true;
      return existing.promise;
    }

    const entry: InFlightEntry = {
      promise: Promise.resolve(false),
      rerunRequested: false,
    };
    entry.promise = (async () => {
      let settled = false;
      do {
        entry.rerunRequested = false;
        settled = await this.perform(normalizedSessionKey)
          .catch((error) => {
            this.dependencies.onError?.(normalizedSessionKey, error);
            return false;
          }) || settled;
      } while (entry.rerunRequested);
      return settled;
    })().finally(() => {
      if (this.inFlightBySession.get(normalizedSessionKey) === entry) {
        this.inFlightBySession.delete(normalizedSessionKey);
      }
    });
    this.inFlightBySession.set(normalizedSessionKey, entry);
    return entry.promise;
  }

  private async perform(sessionKey: string): Promise<boolean> {
    const observation = this.dependencies.captureObservation(sessionKey);
    const runId = observation.pendingRunId;
    if (observation.pendingRunPhase !== 'uncertain' || !runId) return false;
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) return false;

    const result = await this.dependencies.checkRunForConnection(runId, connectionId);
    if (
      !this.dependencies.isConnectionCurrent(connectionId)
      || !this.dependencies.isObservationCurrent(observation)
      || result.status === 'timeout'
    ) {
      return false;
    }
    return this.dependencies.applyTerminal(sessionKey, result.runId, observation);
  }
}
