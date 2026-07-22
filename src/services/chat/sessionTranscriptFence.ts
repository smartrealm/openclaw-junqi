export interface SessionTranscriptReadToken {
  readonly sessionKey: string;
  readonly generation: number;
  readonly expectedSessionId: string | null;
}

/**
 * Prevents history responses captured before reset/delete from repopulating a
 * newer transcript that happens to reuse the same OpenClaw session key.
 */
export class SessionTranscriptFence {
  private readonly generationBySession = new Map<string, number>();

  capture(sessionKey: string, expectedSessionId?: string | null): SessionTranscriptReadToken {
    return {
      sessionKey,
      generation: this.generationBySession.get(sessionKey) ?? 0,
      expectedSessionId: expectedSessionId?.trim() || null,
    };
  }

  isCurrent(token: SessionTranscriptReadToken, responseSessionId?: string | null): boolean {
    if ((this.generationBySession.get(token.sessionKey) ?? 0) !== token.generation) return false;
    const actual = responseSessionId?.trim() || null;
    return !token.expectedSessionId || !actual || token.expectedSessionId === actual;
  }

  invalidate(sessionKey: string): void {
    this.generationBySession.set(sessionKey, (this.generationBySession.get(sessionKey) ?? 0) + 1);
  }
}

export const sessionTranscriptFence = new SessionTranscriptFence();
