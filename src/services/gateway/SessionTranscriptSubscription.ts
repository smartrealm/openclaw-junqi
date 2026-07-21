export interface OpenClawTranscriptTarget {
  sessionKey: string;
  agentId?: string;
}

export interface OpenClawTranscriptTransport {
  request(
    method: 'sessions.messages.subscribe' | 'sessions.messages.unsubscribe',
    params: { key: string; agentId?: string },
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
}

const TRANSCRIPT_SUBSCRIPTION_TIMEOUT_MS = 10_000;

function normalizeTarget(target: OpenClawTranscriptTarget | null): OpenClawTranscriptTarget | null {
  if (!target) return null;
  const sessionKey = target.sessionKey.trim();
  if (!sessionKey) return null;
  const agentId = target.agentId?.trim();
  return agentId ? { sessionKey, agentId } : { sessionKey };
}

function sameTarget(
  left: OpenClawTranscriptTarget | null,
  right: OpenClawTranscriptTarget | null,
): boolean {
  return left?.sessionKey === right?.sessionKey && left?.agentId === right?.agentId;
}

/**
 * Serializes OpenClaw's per-session transcript subscription protocol.
 *
 * A Gateway socket owns these subscriptions, so callers must call
 * `resetTransport` after a disconnect. The next authenticated renderer state
 * explicitly synchronizes its selected session, so a stale in-flight request
 * can never attach itself to a replacement socket.
 */
export class OpenClawSessionTranscriptSubscription {
  private desired: OpenClawTranscriptTarget | null = null;
  private subscribed: OpenClawTranscriptTarget | null = null;
  private draining: Promise<void> | null = null;
  private transportGeneration = 0;

  constructor(private readonly transport: OpenClawTranscriptTransport) {}

  synchronize(target: OpenClawTranscriptTarget | null): Promise<void> {
    this.desired = normalizeTarget(target);
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  /** The server drops socket-owned subscriptions on disconnect. */
  resetTransport(): void {
    this.transportGeneration += 1;
    this.desired = null;
    this.subscribed = null;
  }

  /** Forget the target without issuing an RPC, for renderer teardown. */
  forget(): void {
    this.transportGeneration += 1;
    this.desired = null;
    this.subscribed = null;
  }

  private async drain(): Promise<void> {
    while (!sameTarget(this.desired, this.subscribed)) {
      const current = this.subscribed;
      if (current) {
        this.subscribed = null;
        await this.transport.request(
          'sessions.messages.unsubscribe',
          this.paramsFor(current),
          { timeoutMs: TRANSCRIPT_SUBSCRIPTION_TIMEOUT_MS },
        );
        continue;
      }

      const desired = this.desired;
      if (!desired) return;
      const generation = this.transportGeneration;
      await this.transport.request(
        'sessions.messages.subscribe',
        this.paramsFor(desired),
        { timeoutMs: TRANSCRIPT_SUBSCRIPTION_TIMEOUT_MS },
      );
      if (generation !== this.transportGeneration) continue;
      this.subscribed = desired;
    }
  }

  private paramsFor(target: OpenClawTranscriptTarget): { key: string; agentId?: string } {
    return target.agentId ? { key: target.sessionKey, agentId: target.agentId } : { key: target.sessionKey };
  }
}
