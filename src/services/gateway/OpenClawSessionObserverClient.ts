export const OPENCLAW_SESSION_OBSERVER_VISIBILITY_METHOD = 'sessions.observer.visibility' as const;

export interface OpenClawSessionObserverVisibilityDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  hasAdvertisedMethod: (method: string) => boolean | null;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export type OpenClawSessionObserverVisibilityResult = 'applied' | 'unavailable';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Serializes the Gateway-owned per-connection observer visibility declaration. */
export class OpenClawSessionObserverClient {
  private desired = false;
  private applied: { connectionId: string; visible: boolean } | null = null;
  private draining: Promise<OpenClawSessionObserverVisibilityResult> | null = null;

  constructor(private readonly dependencies: OpenClawSessionObserverVisibilityDependencies) {}

  setVisible(visible: boolean): Promise<OpenClawSessionObserverVisibilityResult> {
    this.desired = visible;
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  resetTransport(): void {
    this.desired = false;
    this.applied = null;
  }

  private async drain(): Promise<OpenClawSessionObserverVisibilityResult> {
    for (;;) {
      const visible = this.desired;
      if (this.dependencies.hasAdvertisedMethod(OPENCLAW_SESSION_OBSERVER_VISIBILITY_METHOD) !== true) {
        this.applied = null;
        return 'unavailable';
      }
      const connectionId = this.dependencies.captureConnectionId();
      if (!connectionId) {
        this.applied = null;
        return visible ? 'unavailable' : 'applied';
      }
      if (this.applied?.connectionId !== connectionId) this.applied = null;
      if (this.applied?.visible === visible) return 'applied';
      try {
        const response = record(await this.dependencies.requestFenced(
          OPENCLAW_SESSION_OBSERVER_VISIBILITY_METHOD,
          { visible },
          connectionId,
        ));
        if (!response || response.ok !== true || !this.dependencies.isConnectionCurrent(connectionId)) {
          this.applied = null;
          return 'unavailable';
        }
        this.applied = { connectionId, visible };
      } catch {
        this.applied = null;
        return 'unavailable';
      }
      if (this.desired === visible) return 'applied';
    }
  }
}
