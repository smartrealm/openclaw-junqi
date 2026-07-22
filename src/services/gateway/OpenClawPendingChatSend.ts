export type OpenClawPendingChatSendPhase = 'dispatching' | 'uncertain';

export interface OpenClawPendingChatSend {
  sessionKey: string;
  runId: string;
  generation: number;
  phase: OpenClawPendingChatSendPhase;
}

/**
 * Tracks the interval between a local send decision and authoritative
 * OpenClaw run evidence. This is renderer-only transaction state; it never
 * adds fields to the Gateway protocol.
 */
export class OpenClawPendingChatSendRegistry {
  private readonly sendsBySession = new Map<string, OpenClawPendingChatSend>();
  private generation = 0;

  begin(sessionKey: string, runId: string): OpenClawPendingChatSend {
    const current = this.sendsBySession.get(sessionKey);
    if (current) {
      if (current.runId === runId) return current;
      throw new Error(`A chat send is already pending for session ${sessionKey}`);
    }
    const send = {
      sessionKey,
      runId,
      generation: ++this.generation,
      phase: 'dispatching' as const,
    };
    this.sendsBySession.set(sessionKey, send);
    return send;
  }

  current(sessionKey: string): OpenClawPendingChatSend | null {
    return this.sendsBySession.get(sessionKey) ?? null;
  }

  sessionKeys(): string[] {
    return [...this.sendsBySession.keys()];
  }

  markUncertain(sessionKey: string, runId: string): OpenClawPendingChatSend | null {
    const current = this.sendsBySession.get(sessionKey);
    if (!current || current.runId !== runId) return null;
    const uncertain = { ...current, phase: 'uncertain' as const };
    this.sendsBySession.set(sessionKey, uncertain);
    return uncertain;
  }

  complete(sessionKey: string, runId?: string): OpenClawPendingChatSend | null {
    const current = this.sendsBySession.get(sessionKey);
    if (!current || (runId && current.runId !== runId)) return null;
    this.sendsBySession.delete(sessionKey);
    return current;
  }

  invalidate(sessionKey: string): void {
    this.sendsBySession.delete(sessionKey);
  }
}
