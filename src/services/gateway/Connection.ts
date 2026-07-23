// ═══════════════════════════════════════════════════════════
// GatewayConnection — Transport Layer
// Handles WebSocket lifecycle, heartbeat,
// request/response, handshake, and pairing.
// No chat logic, no tool logic — pure transport.
// ═══════════════════════════════════════════════════════════

import { startPolling, stopPolling } from '@/stores/gatewayDataStore';
import {
  MessageRouter,
  classifyGatewayAuthorizationError,
  type GatewayAuthorizationIssue,
} from './messageRouter';
import { ConnectionRetryPolicy } from './ConnectionRetryPolicy';
import { APP_VERSION } from '@/hooks/useAppVersion';
import { debugError, debugLog, debugWarn } from '@/utils/debugLog';
import i18n from '@/i18n';
import { gatewayLocaleForLanguage } from './gatewayLocale';
import type { GatewayHelloObservation, RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  buildGatewayHelloObservation,
  invalidateGatewayRuntimeIdentity,
  observeGatewayHello,
} from './runtimeIdentity';

// OpenClaw 2026.5.x introduced a newer WS protocol while older installs still
// negotiate protocol 3. Advertise a compatible range so Desktop can connect to
// both without pinning the bundled gateway to one exact revision.
const GATEWAY_PROTOCOL_MIN = 3;
const GATEWAY_PROTOCOL_MAX = 4;
export type GatewayOperatorScope =
  | 'operator.read'
  | 'operator.write'
  | 'operator.admin'
  | 'operator.approvals'
  | 'operator.pairing';

export const DAILY_OPERATOR_SCOPES: readonly GatewayOperatorScope[] = [
  'operator.read',
  'operator.write',
];

export interface GatewayConnectionOptions {
  scopes?: readonly GatewayOperatorScope[];
  /** A one-operation connection that must not own global polling or runtime identity. */
  transient?: boolean;
}

// ── Platform Detection (cross-platform) ──
export function detectPlatform(): string {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}

// ── Locale from app language ──
export function getAppLocale(): string {
  return gatewayLocaleForLanguage(i18n.language);
}

// ── Shared chat message type ──
// Defined here (not in ChatHandler) to avoid circular imports,
// since GatewayCallbacks.onMessage references it.
export interface ChatMessage {
  id: string;
  sessionKey?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface MediaInfo {
  mediaUrl?: string;
  mediaType?: string;
}

export interface StreamEndMeta {
  state?: 'final' | 'aborted' | 'error';
  refreshHistory?: boolean;
  runId?: string | null;
  fileRefs?: Array<{
    path: string;
    meta?: string;
  }>;
  decisionOptions?: Array<{ text: string; value: string }>;
  workshopEvents?: Array<{ kind: string; text: string }>;
  sessionEvents?: Array<{
    kind: 'compaction' | 'fallback' | 'retry' | 'reset' | 'token-warning' | 'context-warning' | 'info';
    text: string;
  }>;
  usage?: Record<string, number>;
  model?: string | null;
}

export interface GatewaySessionRunReconciliation {
  sessionKey: string;
  state: 'active' | 'settled';
  activeRunIds: string[];
  activeRunId?: string;
}

export interface GatewayTranscriptMessageNotice {
  sessionKey: string;
  role: string;
  text: string;
  nativeMessageId?: string;
  clientMessageId?: string;
  messageSeq?: number;
  /** True when the same socket already projected this run through live events. */
  liveProjected: boolean;
}

export interface GatewayCallbacks {
  onMessage: (msg: ChatMessage) => void;
  onStreamChunk: (sessionKey: string, messageId: string, content: string, media?: MediaInfo, runId?: string | null) => void;
  onStreamEnd: (sessionKey: string, messageId: string, content: string, media?: MediaInfo, meta?: StreamEndMeta) => void;
  /** Authoritative run state observed from OpenClaw sessions.list after reconnect. */
  onSessionRunReconciliation?: (resolution: GatewaySessionRunReconciliation) => void;
  /** A run sequence gap requires a durable history refresh before trusting live text. */
  onStreamReconciliationNeeded?: (sessionKey: string, runId: string) => void;
  /** A durable transcript snapshot could not be tied to the locally active run. */
  onSessionRunReconciliationNeeded?: (sessionKey: string) => void;
  /** An official `session.message` notification changed a durable transcript. */
  onTranscriptChanged?: (sessionKey: string) => void;
  /** Typed durable message notice for unread and notification projection only. */
  onTranscriptMessage?: (notice: GatewayTranscriptMessageNotice) => void;
  onStatusChange: (status: { connected: boolean; connecting: boolean; error?: string }) => void;
  onRetryState?: (state: GatewayRetryState) => void;
  /** Structured authorization failure from the Gateway protocol. */
  onAuthorizationIssue?: (issue: GatewayAuthorizationIssue) => void;
  /** @deprecated Use onAuthorizationIssue. Retained for auxiliary clients. */
  onScopeError?: (error: string) => void;
  /** Fired after successful re-pairing (token received) */
  onPairingComplete?: (token: string) => void;
  /** Raw, normalized hello-ok facts before local runtime attestation. */
  onHello?: (observation: GatewayHelloObservation) => void;
  /** Cross-checked Gateway identity, or null when its socket is invalidated. */
  onRuntimeIdentity?: (identity: RuntimeIdentity | null) => void;
}

export interface GatewayRetryState {
  phase: 'attempting' | 'backoff' | 'connected' | 'exhausted' | 'idle';
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
  error?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface GatewayRequestOptions {
  /**
   * `null` keeps an interactive request open until the Gateway responds or
   * the WebSocket closes. Some official setup operations wait on a person or
   * a third-party device longer than the normal RPC timeout.
   */
  timeoutMs?: number | null;
}

/**
 * A failed Gateway RPC response. Keep this deliberately narrower than the
 * response envelope so callers receive the protocol contract without leaking
 * unrelated transport fields.
 */
export class GatewayRpcError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewayRpcError';
  }

  override toString(): string {
    return this.message;
  }
}

export class GatewayDisconnectedError extends Error {
  readonly code = 'GATEWAY_DISCONNECTED';

  constructor() {
    super('Gateway is not connected');
    this.name = 'GatewayDisconnectedError';
  }
}

export class GatewayConnectionFenceError extends Error {
  readonly code = 'GATEWAY_CONNECTION_FENCE_MISMATCH';

  constructor(
    public readonly expectedConnectionId: string,
    public readonly actualConnectionId: string | null,
  ) {
    super('The Gateway connection changed before the fenced request completed');
    this.name = 'GatewayConnectionFenceError';
  }
}

function gatewayRpcError(value: unknown): GatewayRpcError {
  const error = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const message =
    (typeof error?.message === 'string' && error.message) ||
    (typeof value === 'string' && value) ||
    'Request failed';
  const code = typeof error?.code === 'string' && error.code.length > 0
    ? error.code
    : undefined;
  return new GatewayRpcError(message, code, error?.details);
}

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  callbacks: GatewayCallbacks | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private msgCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly retryPolicy = new ConnectionRetryPolicy(3);
  private readonly CONNECTION_ATTEMPT_TIMEOUT_MS = 8_000;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeRequestId: string | null = null;
  private runtimeIdentityConnectionId: string | null = null;

  // ── Pairing detection (gentle retry instead of exponential backoff) ──
  private pairingRequired = false;
  private pairingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PAIRING_RETRY_MS = 5_000;

  // Device identity challenge nonce (from connect.challenge event)
  private challengeNonce: string | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  // Stable per-window instance ID for diagnostics
  private readonly instanceId =
    crypto.randomUUID?.() || `aegis-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // ── Heartbeat (activity-based dead connection detection) ──
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatPingTimer: ReturnType<typeof setTimeout> | null = null;
  private msgRouter = new MessageRouter();
  private readonly HEARTBEAT_DEAD_MS = 90_000; // No traffic for 90s = dead

  // ── Last error for diagnostics and recovery surfaces ──
  private lastError: string | null = null;
  private readonly requestedScopes: readonly GatewayOperatorScope[];
  private readonly transient: boolean;

  url = '';
  /** Explicit/shared Gateway token. Device credentials are stored separately. */
  token = '';
  deviceToken = '';

  // ── Event callback (set by ChatHandler) ──
  /** Called for every incoming non-response event from the WebSocket. */
  onEvent: (msg: any) => void = () => {};

  constructor(options: GatewayConnectionOptions = {}) {
    this.requestedScopes = [...new Set(options.scopes?.length ? options.scopes : DAILY_OPERATOR_SCOPES)];
    this.transient = options.transient === true;
    // Register message handlers once — they never change and MessageRouter
    // uses set() semantics, so calling this in connect() would be a no-op,
    // but initializing here is the correct ownership model.
    this.initMessageRouter();
  }

  // ══════════════════════════════════════════════════════
  // Heartbeat Management
  // ══════════════════════════════════════════════════════

  private startHeartbeat() {
    this.resetHeartbeat();
  }

  private resetHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.heartbeatPingTimer) clearTimeout(this.heartbeatPingTimer);
    if (!this.connected) return;

    // Send a keepalive ping halfway through to provoke traffic
    this.heartbeatPingTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ method: 'ping', id: this.nextId() }));
        } catch {}
      }
    }, this.HEARTBEAT_DEAD_MS / 2);

    this.heartbeatTimer = setTimeout(() => {
      debugWarn('gateway', '[GW] ❌ No traffic for', this.HEARTBEAT_DEAD_MS / 1000, 's — connection dead');
      this.ws?.close(4000, 'Heartbeat timeout');
    }, this.HEARTBEAT_DEAD_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) { clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatPingTimer) { clearTimeout(this.heartbeatPingTimer); this.heartbeatPingTimer = null; }
  }

  /** Returns true when the WebSocket is established and handshake succeeded */
  isConnected(): boolean {
    return this.connected;
  }

  /** The attested socket identity used by requestFenced. */
  getAttestedConnectionId(): string | null {
    return this.runtimeIdentityConnectionId;
  }

  // ══════════════════════════════════════════════════════
  // Setup
  // ══════════════════════════════════════════════════════

  setCallbacks(cb: GatewayCallbacks) {
    this.callbacks = cb;
  }

  // ══════════════════════════════════════════════════════
  // Connect / Disconnect
  // ══════════════════════════════════════════════════════

  connect(
    url: string,
    token: string,
    deviceToken = '',
    resetReconnectAttempts = true,
  ) {
    this.url = url;
    this.token = token;
    this.deviceToken = deviceToken;
    resetReconnectAttempts ? this.retryPolicy.begin() : this.retryPolicy.beginRetry();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws && (this.connected || this.connecting)) return;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connecting = true;
    this.lastError = null;
    this.emitStatus();

    debugLog('gateway', '[GW] Connecting:', url);

    // Capture the WS instance locally so all handlers can guard against stale
    // close/open events from a previous connection being replaced mid-flight.
    // Without this guard, disconnect() + immediate connect() causes the old
    // onclose to fire AFTER the new WS is created, setting this.ws = null and
    // this.connecting = false on the new connection — silently killing the
    // token-only handshake timer.
    const ws = new WebSocket(url);
    this.ws = ws;
    this.startAttemptDeadline(ws);
    this.emitRetryState('attempting');

    ws.onopen = () => {
      if (this.ws !== ws) return; // stale — a newer connection replaced us
      debugLog('gateway', '[GW] Open — waiting for connect.challenge...');
      this.challengeNonce = null;
      // Wait up to 2s for challenge nonce (v2 auth).
      // If it doesn't arrive, proceed with token-only auth.
      this.connectTimer = setTimeout(() => {
        if (this.ws !== ws) return; // stale
        if (this.connecting) {
          debugLog('gateway', '[GW] No challenge received — proceeding with token-only auth');
          this.sendHandshake();
        }
      }, 2000);
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return; // stale
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        debugError('gateway', '[GW] Parse error:', e);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return; // stale — ignore close from a superseded WS
      debugLog('gateway', '[GW] Closed:', event.code, event.reason);
      this.stopHeartbeat();
      this.clearAttemptTimers();
      if (!this.transient) stopPolling();
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      if (!this.transient) this.invalidateObservedRuntimeIdentity();
      this.rejectAllPending(event.reason || 'Gateway connection closed');
      this.emitStatus();

      // 1008 is a generic policy close. Only the structured Gateway code (or a
      // legacy reason that explicitly says pairing required) may enter pairing.
      if (!this.pairingRequired) {
        const closeIssue = classifyGatewayAuthorizationError({ message: event.reason });
        if (closeIssue?.kind === 'pairing_required') {
          this.pairingRequired = true;
          this.emitAuthorizationIssue(closeIssue);
        }
      }

      if (this.transient) {
        return;
      }

      // Pairing required — gentle retry instead of exponential backoff
      if (this.pairingRequired) {
        this.schedulePairingRetry();
        return;
      }

      this.scheduleReconnect();
      this.emitStatus();
    };

    ws.onerror = (event) => {
      debugError('gateway', '[GW] Error:', event);
      this.lastError = 'Connection error';
    };
  }

  disconnect() {
    this.stopHeartbeat();
    this.stopPairingRetry();
    this.clearAttemptTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.rejectAllPending('Gateway connection closed');
    this.connected = false;
    this.connecting = false;
    if (!this.transient) this.invalidateObservedRuntimeIdentity();
    this.emitRetryState('idle');
    this.emitStatus();
  }

  private scheduleReconnect() {
    const decision = this.retryPolicy.next();
    if (decision.exhausted) {
      const error = this.lastError || 'Gateway connection attempts exhausted';
      this.emitRetryState('exhausted', { error });
      this.emitStatus({ error });
      return;
    }
    const { nextAttempt, delayMs } = decision;
    debugLog('gateway', `[GW] Reconnecting in ${delayMs}ms (attempt ${nextAttempt}/${decision.maxAttempts})`);
    this.emitRetryState('backoff', { attempt: nextAttempt, delayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.url, this.token, this.deviceToken, false);
    }, delayMs);
  }

  private startAttemptDeadline(ws: WebSocket) {
    this.clearAttemptTimers();
    this.attemptTimer = setTimeout(() => {
      if (this.ws !== ws || this.connected) return;
      this.lastError = `Gateway handshake timed out after ${this.CONNECTION_ATTEMPT_TIMEOUT_MS}ms`;
      debugWarn('gateway', `[GW] ${this.lastError}`);
      ws.close(4000, 'Gateway handshake timeout');
    }, this.CONNECTION_ATTEMPT_TIMEOUT_MS);
  }

  private clearAttemptTimers() {
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    if (this.attemptTimer) { clearTimeout(this.attemptTimer); this.attemptTimer = null; }
    this.handshakeRequestId = null;
  }

  private emitRetryState(
    phase: GatewayRetryState['phase'],
    extra: Partial<GatewayRetryState> = {},
  ) {
    this.callbacks?.onRetryState?.({
      phase,
      attempt: extra.attempt ?? this.retryPolicy.attempt,
      maxAttempts: this.retryPolicy.maxAttempts,
      ...extra,
    });
  }

  private rejectAllPending(reason: string) {
    const pending = [...this.pendingRequests.values()];
    this.pendingRequests.clear();
    for (const request of pending) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(reason);
    }
  }

  private isTryingToConnect(): boolean {
    return this.connecting || this.reconnectTimer !== null || this.pairingRetryTimer !== null;
  }

  // ══════════════════════════════════════════════════════
  // Handshake
  // ══════════════════════════════════════════════════════

  private async sendHandshake() {
    if (this.handshakeRequestId) return;
    const id = this.nextId();
    this.handshakeRequestId = id;
    const handshakeSocket = this.ws;
    const scopes = [...this.requestedScopes];
    const clientId = 'openclaw-control-ui';
    const clientMode = 'ui';

    this.registerCallback(
      id,
      {
      resolve: (response: any) => {
        debugLog('gateway', '[GW] Handshake response:', JSON.stringify(response).substring(0, 200));
        if (response.ok !== false && (response.payload?.type === 'hello-ok' || response.type === 'hello-ok')) {
          debugLog('gateway', '[GW] ✅ Connected!');
          const helloPayload = response.payload?.type === 'hello-ok' ? response.payload : response;
          const auth = helloPayload.auth;
          if (!this.transient) {
            const helloObservation = buildGatewayHelloObservation(this.url, helloPayload);
            this.runtimeIdentityConnectionId = helloObservation.connectionId || null;
            this.callbacks?.onHello?.(helloObservation);
            void observeGatewayHello(helloObservation)
              .then((identity) => {
                if (this.ws === handshakeSocket && identity) {
                  this.callbacks?.onRuntimeIdentity?.(identity);
                }
              })
              .catch((error) => {
                debugWarn('gateway', '[GW] Runtime identity attestation failed:', error);
            });
          }
          if (!this.transient && auth?.deviceToken && window.aegis?.pairing?.saveToken) {
            this.deviceToken = auth.deviceToken;
            window.aegis.pairing.saveToken(auth.deviceToken, this.url).catch(() => {});
          }
          this.connected = true;
          this.connecting = false;
          this.lastError = null;
          this.clearAttemptTimers();
          this.pairingRequired = false;
          if (this.pairingRetryTimer) {
            clearTimeout(this.pairingRetryTimer);
            this.pairingRetryTimer = null;
          }
          this.startHeartbeat();
          this.emitRetryState('connected');
          this.emitStatus();
          if (!this.transient) {
            startPolling(this);
            // Labels and deletes may be initiated by another OpenClaw client.
            // Subscribe once per connected socket so those mutations propagate
            // immediately instead of waiting for the 10s polling interval.
            void this.request('sessions.subscribe', {}).catch((error) => {
              debugWarn('gateway', '[GW] Unable to subscribe to session changes:', error);
            });
          }
        } else {
          const err = response.error?.message || JSON.stringify(response);
          debugError('gateway', '[GW] ❌ Handshake failed:', err);
          this.connected = false;
          this.connecting = false;
          this.emitStatus({ error: err });
          if (handshakeSocket && this.ws === handshakeSocket) {
            handshakeSocket.close(4001, 'Gateway handshake failed');
          }
        }
      },
      reject: (err: any) => {
        const errStr = String(err);
        debugError('gateway', '[GW] ❌ Handshake rejected:', errStr);
        this.connecting = false;
        const authorizationIssue = classifyGatewayAuthorizationError(err);
        this.pairingRequired = authorizationIssue?.kind === 'pairing_required';
        this.lastError = errStr;
        if (authorizationIssue) this.emitAuthorizationIssue(authorizationIssue);
        this.emitStatus({ error: errStr });
        if (handshakeSocket && this.ws === handshakeSocket) {
          handshakeSocket.close(
            this.pairingRequired ? 1008 : 4001,
            this.pairingRequired ? 'Gateway authorization required' : 'Gateway handshake rejected',
          );
        }
      },
    },
      { timeoutMs: this.CONNECTION_ATTEMPT_TIMEOUT_MS },
    );

    // Build device identity if available (Electron IPC)
    // Gateway 2026.2.22+ requires v2 signatures.
    // If no challenge nonce arrived, skip device and use token-only auth.
    const sharedToken = this.token.trim();
    const storedDeviceToken = this.deviceToken.trim();
    const authToken = sharedToken || storedDeviceToken;
    // Match OpenClaw's client precedence: try the explicit shared token first.
    // A stored device token is sent as deviceToken only when no shared token is
    // available; a successful shared-token handshake rotates it via hello-ok.
    const authDeviceToken = sharedToken ? '' : storedDeviceToken;
    let device: any = undefined;
    try {
      if (window.aegis?.device?.sign && this.challengeNonce) {
        const signed = await window.aegis.device.sign({
          nonce: this.challengeNonce,
          clientId,
          clientMode,
          role: 'operator',
          scopes,
          token: authToken,
        });
        if (signed.signature) {
          device = {
            id: signed.deviceId,
            publicKey: signed.publicKey,
            signature: signed.signature,
            signedAt: signed.signedAt,
            nonce: signed.nonce,
          };
          debugLog('gateway', '[GW] 🔑 Device identity attached (v2):', signed.deviceId.substring(0, 16) + '...');
        } else {
          debugWarn('gateway', '[GW] Device signing returned no signature — skipping device auth');
        }
      } else if (!this.challengeNonce) {
        debugLog('gateway', '[GW] No challenge nonce — using token-only auth');
      }
    } catch (err) {
      debugWarn('gateway', '[GW] Device identity unavailable:', err);
    }

    const platform = detectPlatform();
    const locale = getAppLocale();

    this.send({
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: GATEWAY_PROTOCOL_MIN,
        maxProtocol: GATEWAY_PROTOCOL_MAX,
        client: {
          id: clientId,
          version: APP_VERSION,
          platform,
          mode: clientMode,
        },
        role: 'operator',
        scopes,
        caps: ['tool-events'],
        commands: [],
        permissions: {},
        auth: {
          ...(authToken ? { token: authToken } : {}),
          ...(authDeviceToken ? { deviceToken: authDeviceToken } : {}),
        },
        device,
        locale,
        userAgent: `aegis-desktop/${APP_VERSION} (${platform})`,
      },
    });
  }

  // ══════════════════════════════════════════════════════
  // Request / Response
  // ══════════════════════════════════════════════════════

  async request(method: string, params: any, options?: GatewayRequestOptions): Promise<any> {
    if (!this.ws || !this.connected) throw new Error('Not connected');

    return new Promise((resolve, reject) => {
      const id = this.nextId();
      this.registerCallback(id, { resolve, reject }, options);
      this.send({ type: 'req', id, method, params });
    });
  }

  /**
   * Dispatch an identity-sensitive RPC only on the socket that produced the
   * attested connection id. JavaScript cannot interleave a reconnect between
   * the synchronous fence check and WebSocket.send; close/swap rejects the
   * pending request, and the response path verifies the fence again.
   */
  async requestFenced(
    method: string,
    params: any,
    expectedConnectionId: string,
    options?: GatewayRequestOptions,
  ): Promise<any> {
    const expected = expectedConnectionId.trim();
    const socket = this.ws;
    const actual = this.runtimeIdentityConnectionId;
    if (
      !expected
      || !socket
      || !this.connected
      || socket.readyState !== WebSocket.OPEN
      || actual !== expected
    ) {
      throw new GatewayConnectionFenceError(expected, actual);
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId();
      const verifyFence = () => this.ws === socket
        && this.connected
        && this.runtimeIdentityConnectionId === expected;
      const rejectFenced = (error: unknown) => {
        if (!verifyFence()) {
          reject(new GatewayConnectionFenceError(expected, this.runtimeIdentityConnectionId));
          return;
        }
        reject(error);
      };
      this.registerCallback(id, {
        resolve: (value) => {
          if (!verifyFence()) {
            reject(new GatewayConnectionFenceError(expected, this.runtimeIdentityConnectionId));
            return;
          }
          resolve(value);
        },
        reject: rejectFenced,
      }, options);
      try {
        socket.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (error) {
        const pending = this.pendingRequests.get(id);
        if (pending?.timer) clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        rejectFenced(error);
      }
    });
  }

  registerCallback(
    id: string,
    handlers: { resolve: (v: any) => void; reject: (e: any) => void },
    options?: GatewayRequestOptions,
  ) {
    const configuredTimeout = options?.timeoutMs;
    const timeoutMs = configuredTimeout === null
      ? null
      : Math.max(1000, configuredTimeout ?? 120_000);
    const timer = timeoutMs === null ? null : setTimeout(() => {
      this.pendingRequests.delete(id);
      handlers.reject(`Request timeout (${timeoutMs}ms)`);
    }, timeoutMs);
    this.pendingRequests.set(id, { ...handlers, timer });
  }

  send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  nextId(): string {
    return `aegis-${Date.now()}-${++this.msgCounter}`;
  }

  // ══════════════════════════════════════════════════════
  // Message Routing
  // ══════════════════════════════════════════════════════

  /** Initialize the message router with all handler registrations. */
  private initMessageRouter(): void {
    this.msgRouter
      // connect.challenge — extract nonce, trigger handshake
      .on('event', (msg) => {
        const nonce = msg.payload?.nonce;
        if (nonce && typeof nonce === 'string') {
          debugLog('gateway', '[GW] 🔑 Received connect.challenge with nonce');
          this.challengeNonce = nonce;
          if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
          this.sendHandshake();
        }
      }, 'connect.challenge')
      // Response — resolve/reject pending requests
      .on('res', (msg) => {
        const pending = this.pendingRequests.get(msg.id);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.ok !== false) {
          pending.resolve(msg.payload ?? msg);
        } else {
          const error = gatewayRpcError(msg.error);
          const authorizationIssue = classifyGatewayAuthorizationError(error);
          if (authorizationIssue) {
            debugWarn('gateway', '[GW] Authorization issue detected:', authorizationIssue.code);
            if (authorizationIssue.kind === 'pairing_required') this.pairingRequired = true;
            this.emitAuthorizationIssue(authorizationIssue);
          }
          pending.reject(error);
        }
      })
      // Generic events — forward to ChatHandler
      .on('event', (msg) => { this.onEvent(msg); });
  }

  private handleMessage(msg: any) {
    // Any incoming message = connection alive — reset heartbeat timer
    this.resetHeartbeat();
    this.msgRouter.route(msg);
  }

  private emitAuthorizationIssue(issue: GatewayAuthorizationIssue): void {
    if (this.callbacks?.onAuthorizationIssue) {
      this.callbacks.onAuthorizationIssue(issue);
      return;
    }
    this.callbacks?.onScopeError?.(issue.message);
  }

  private invalidateObservedRuntimeIdentity() {
    const connectionId = this.runtimeIdentityConnectionId;
    this.runtimeIdentityConnectionId = null;
    if (!connectionId) return;
    this.callbacks?.onRuntimeIdentity?.(null);
    void invalidateGatewayRuntimeIdentity(connectionId).catch((error) => {
      debugWarn('gateway', '[GW] Failed to invalidate runtime identity:', error);
    });
  }

  // ══════════════════════════════════════════════════════
  // Status
  // ══════════════════════════════════════════════════════

  emitStatus(extra?: { error?: string }) {
    if (extra?.error) {
      this.lastError = extra.error;
    }
    this.callbacks?.onStatusChange({
      connected: this.connected,
      connecting: this.isTryingToConnect(),
      ...extra,
    });
  }

  getStatus() {
    return { connected: this.connected, connecting: this.isTryingToConnect() };
  }

  /** Returns the last connection error message, useful for diagnostics. */
  getLastError(): string | null {
    return this.lastError;
  }

  // ══════════════════════════════════════════════════════
  // Pairing
  // ══════════════════════════════════════════════════════

  private schedulePairingRetry() {
    if (this.pairingRetryTimer) clearTimeout(this.pairingRetryTimer);
    this.pairingRetryTimer = setTimeout(() => {
      if (this.pairingRequired && !this.connected && !this.connecting) {
        debugLog('gateway', '[GW] 🔑 Pairing retry...');
        this.connect(this.url, this.token, this.deviceToken);
      }
    }, this.PAIRING_RETRY_MS);
  }

  /** Stop pairing retry loop (called from cancel or disconnect) */
  stopPairingRetry() {
    this.pairingRequired = false;
    if (this.pairingRetryTimer) {
      clearTimeout(this.pairingRetryTimer);
      this.pairingRetryTimer = null;
    }
  }

  /** Derive HTTP base URL from the WebSocket URL */
  getHttpBaseUrl(): string {
    return this.url
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/+$/, '');
  }

  /** Reconnect with a new token (after pairing approval) */
  reconnectWithToken(newToken: string) {
    debugLog('gateway', '[GW] 🔑 Reconnecting with new token');
    this.stopHeartbeat();
    this.stopPairingRetry();
    this.clearAttemptTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this.invalidateObservedRuntimeIdentity();
    this.retryPolicy.reset();
    this.rejectAllPending('Gateway credentials changed');
    this.token = newToken;
    setTimeout(() => this.connect(this.url, newToken, this.deviceToken), 300);
  }

  // ── Enable reasoning visibility for a session (lazy) ──
  async ensureReasoningStream(sessionKey = 'agent:main:main') {
    try {
      await this.request('sessions.patch', { key: sessionKey, reasoningLevel: 'on' }, { timeoutMs: 15_000 });
      debugLog('gateway', '[GW] 🧠 Reasoning visibility enabled');
    } catch (err) {
      debugWarn('gateway', '[GW] Could not enable reasoning:', err);
    }
  }
}
