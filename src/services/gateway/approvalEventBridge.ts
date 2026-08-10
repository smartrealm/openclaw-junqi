import {
  GatewayConnection,
  type GatewayCallbacks,
  type GatewayConnectionOptions,
} from './Connection';

export type GatewayApprovalEventKind = 'exec' | 'plugin';
export type GatewayApprovalEventPhase = 'requested' | 'resolved';

export interface GatewayApprovalEvent {
  readonly kind: GatewayApprovalEventKind;
  readonly phase: GatewayApprovalEventPhase;
  readonly id: string;
}

export type GatewayApprovalEventListener = (event: GatewayApprovalEvent) => void;

const listeners = new Set<GatewayApprovalEventListener>();

const APPROVAL_EVENT_NAMES: Readonly<Record<string, Omit<GatewayApprovalEvent, 'id'>>> = {
  'exec.approval.requested': { kind: 'exec', phase: 'requested' },
  'exec.approval.resolved': { kind: 'exec', phase: 'resolved' },
  'plugin.approval.requested': { kind: 'plugin', phase: 'requested' },
  'plugin.approval.resolved': { kind: 'plugin', phase: 'resolved' },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Parse only the event identity used to invalidate the native approval snapshot.
 * Gateway list/history/resolve responses remain the sole source of UI state.
 */
export function parseGatewayApprovalEvent(message: unknown): GatewayApprovalEvent | null {
  const envelope = asRecord(message);
  if (!envelope || envelope.type !== 'event' || typeof envelope.event !== 'string') return null;
  const event = APPROVAL_EVENT_NAMES[envelope.event];
  if (!event) return null;
  const payload = asRecord(envelope.payload);
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  return id ? { ...event, id } : null;
}

/** Publish scope-filtered OpenClaw approval invalidations to the unified projection. */
export function publishGatewayApprovalEvent(message: unknown): boolean {
  const candidate = parseGatewayApprovalEvent(message);
  if (!candidate) return false;
  for (const listener of [...listeners]) {
    try {
      listener(candidate);
    } catch {
      // A listener must not break the Gateway event route for other consumers.
    }
  }
  return true;
}

export function subscribeGatewayApprovalEvents(
  listener: GatewayApprovalEventListener,
): () => void {
  listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
  };
}

export interface GatewayApprovalSubscriptionSource {
  isConnected(): boolean;
  getAttestedConnectionId(): string | null;
  url: string;
  token: string;
  deviceToken: string;
}

type ApprovalEventConnection = Pick<
  GatewayConnection,
  'connect' | 'disconnect' | 'setCallbacks'
> & {
  onEvent: (message: unknown) => void;
};

interface ApprovalSubscriptionTarget {
  connectionId: string;
  url: string;
  token: string;
  deviceToken: string;
}

interface ApprovalSubscriptionRecord {
  target: ApprovalSubscriptionTarget;
  connection: ApprovalEventConnection;
}

export interface GatewayApprovalEventSubscriptionOptions {
  source: GatewayApprovalSubscriptionSource;
  createConnection?: (options: GatewayConnectionOptions) => ApprovalEventConnection;
  onUnavailable?: (error: unknown) => void;
}

const APPROVAL_SCOPE = ['operator.approvals'] as const;
const APPROVAL_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

function captureSubscriptionTarget(
  source: GatewayApprovalSubscriptionSource,
): ApprovalSubscriptionTarget | null {
  if (!source.isConnected()) return null;
  const connectionId = source.getAttestedConnectionId()?.trim() ?? '';
  const url = source.url.trim();
  const token = source.token.trim();
  const deviceToken = source.deviceToken.trim();
  if (!connectionId || !url || (!token && !deviceToken)) return null;
  return { connectionId, url, token, deviceToken };
}

/**
 * Owns a page-lifetime approval event socket with the narrowest Gateway scope.
 * The socket never participates in chat, polling, or runtime identity state.
 */
export class GatewayApprovalEventSubscription {
  private readonly source: GatewayApprovalSubscriptionSource;
  private readonly createConnection: (
    options: GatewayConnectionOptions,
  ) => ApprovalEventConnection;
  private readonly onUnavailable?: (error: unknown) => void;
  private active: ApprovalSubscriptionRecord | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private started = false;

  constructor(options: GatewayApprovalEventSubscriptionOptions) {
    this.source = options.source;
    this.createConnection = options.createConnection ?? ((connectionOptions) => (
      new GatewayConnection(connectionOptions)
    ));
    this.onUnavailable = options.onUnavailable;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.retryAttempt = 0;
    this.clearRetryTimer();
    this.connectIfCurrent();
  }

  stop(): void {
    this.started = false;
    this.retryAttempt = 0;
    this.clearRetryTimer();
    this.disposeActive();
  }

  private connectIfCurrent(): void {
    if (!this.started || this.active) return;
    const target = captureSubscriptionTarget(this.source);
    if (!target) {
      this.reportUnavailable(new Error('A verified Gateway connection is required for approval events'));
      return;
    }

    let connection: ApprovalEventConnection;
    try {
      connection = this.createConnection({
        scopes: [...APPROVAL_SCOPE],
        transient: true,
      });
    } catch (error) {
      this.reportUnavailable(error);
      this.scheduleRetry();
      return;
    }

    const record: ApprovalSubscriptionRecord = { target, connection };
    this.active = record;
    connection.onEvent = (message) => {
      if (this.active !== record || !this.isTargetCurrent(target)) {
        this.disposeActive(record);
        return;
      }
      publishGatewayApprovalEvent(message);
    };

    const onConnectionFailure = (error: unknown) => {
      if (this.active !== record) return;
      this.reportUnavailable(error);
      this.disposeActive(record);
      this.scheduleRetry();
    };

    const callbacks: GatewayCallbacks = {
      onMessage() {},
      onStreamChunk() {},
      onStreamEnd() {},
      onStatusChange: (status) => {
        if (this.active !== record) return;
        if (status.connected) {
          this.retryAttempt = 0;
          return;
        }
        if (!status.connecting) onConnectionFailure(status.error ?? new Error('Approval event connection closed'));
      },
      onAuthorizationIssue: onConnectionFailure,
    };

    try {
      connection.setCallbacks(callbacks);
      connection.connect(target.url, target.token, target.deviceToken);
    } catch (error) {
      onConnectionFailure(error);
    }
  }

  private isTargetCurrent(target: ApprovalSubscriptionTarget): boolean {
    return this.source.isConnected()
      && this.source.url.trim() === target.url
      && this.source.getAttestedConnectionId() === target.connectionId;
  }

  private disposeActive(expected?: ApprovalSubscriptionRecord): void {
    const record = this.active;
    if (!record || (expected && record !== expected)) return;
    this.active = null;
    try {
      record.connection.disconnect();
    } catch {
      // Disconnect is best-effort during a source or page lifecycle change.
    }
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer || this.retryAttempt >= APPROVAL_RETRY_DELAYS_MS.length) return;
    if (!captureSubscriptionTarget(this.source)) return;
    const delayMs = APPROVAL_RETRY_DELAYS_MS[this.retryAttempt];
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connectIfCurrent();
    }, delayMs);
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private reportUnavailable(error: unknown): void {
    try {
      this.onUnavailable?.(error);
    } catch {
      // An observer must not affect the approval transport lifecycle.
    }
  }
}
