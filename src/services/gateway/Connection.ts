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
import { GatewayTransportLifecycleError } from './GatewayTransportError';
import {
  buildGatewayHelloObservation,
  invalidateGatewayRuntimeIdentity,
  observeGatewayHello,
} from './runtimeIdentity';
import { storeGatewayConnectionDeviceCredential } from './GatewayConnectionTargetResolver';
import { signGatewayDeviceChallenge } from './deviceAuthentication';
import type { OpenClawSessionOperationEvent } from './sessionOperation';
import { getNativePlatformInfo } from '@/api/tauri-commands';

// OpenClaw reserves protocol v3 compatibility for node/probe clients. JunQi
// connects as an operator/UI client, whose current wire contract is v4.
export const GATEWAY_OPERATOR_PROTOCOL_VERSION = 4;
const GATEWAY_PROTOCOL_MIN = GATEWAY_OPERATOR_PROTOCOL_VERSION;
const GATEWAY_PROTOCOL_MAX = GATEWAY_OPERATOR_PROTOCOL_VERSION;
const GATEWAY_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_GATEWAY_TICK_INTERVAL_MS = 30_000;
const MIN_GATEWAY_TICK_WATCH_INTERVAL_MS = 1_000;

function isGatewayOperatorProtocol(value: unknown): value is typeof GATEWAY_OPERATOR_PROTOCOL_VERSION {
  return value === GATEWAY_OPERATOR_PROTOCOL_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

interface GatewayHelloPolicy {
  maxPayload: number;
  maxBufferedBytes: number;
  tickIntervalMs: number;
}

interface ValidatedGatewayHello {
  payload: Record<string, unknown>;
  methods: string[];
  authDeviceToken: string | null;
  policy: GatewayHelloPolicy;
}

function validateGatewayHello(value: unknown): ValidatedGatewayHello | null {
  if (!isRecord(value) || value.type !== 'hello-ok' || !isGatewayOperatorProtocol(value.protocol)) {
    return null;
  }
  const server = value.server;
  const features = value.features;
  const snapshot = value.snapshot;
  const auth = value.auth;
  const policy = value.policy;
  if (!isRecord(server) || !isNonEmptyString(server.version) || !isNonEmptyString(server.connId)) return null;
  if (
    !isRecord(features)
    || !isNonEmptyStringArray(features.methods)
    || !isNonEmptyStringArray(features.events)
  ) return null;
  if (
    !isRecord(snapshot)
    || !Array.isArray(snapshot.presence)
    || !isRecord(snapshot.health)
    || !isRecord(snapshot.stateVersion)
    || !isNonNegativeSafeInteger(snapshot.stateVersion.presence)
    || !isNonNegativeSafeInteger(snapshot.stateVersion.health)
    || !isNonNegativeSafeInteger(snapshot.uptimeMs)
  ) return null;
  if (!isRecord(auth) || !isNonEmptyString(auth.role) || !isNonEmptyStringArray(auth.scopes)) return null;
  if (
    !isRecord(policy)
    || !isPositiveSafeInteger(policy.maxPayload)
    || !isPositiveSafeInteger(policy.maxBufferedBytes)
    || !isPositiveSafeInteger(policy.tickIntervalMs)
  ) return null;
  return {
    payload: value,
    methods: features.methods,
    authDeviceToken: isNonEmptyString(auth.deviceToken) ? auth.deviceToken : null,
    policy: {
      maxPayload: policy.maxPayload,
      maxBufferedBytes: policy.maxBufferedBytes,
      tickIntervalMs: policy.tickIntervalMs,
    },
  };
}
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
  /** Persists a rotated device token after a non-transient hello handshake. */
  persistDeviceCredential?: (gatewayUrl: string, token: string) => Promise<unknown>;
}

// ── Platform Detection (cross-platform) ──
export type GatewayClientPlatform = 'macos' | 'windows' | 'linux' | 'unknown';

export interface GatewayPlatformHints {
  userAgent?: string;
  platform?: string;
}

export function platformFromNativeOs(os: string): GatewayClientPlatform {
  switch (os.trim().toLowerCase()) {
    case 'darwin':
    case 'macos':
      return 'macos';
    case 'windows':
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

export function platformFromWebView(hints: GatewayPlatformHints | null | undefined): GatewayClientPlatform {
  const description = `${hints?.platform ?? ''} ${hints?.userAgent ?? ''}`.toLowerCase();
  if (description.includes('win')) return 'windows';
  if (description.includes('mac')) return 'macos';
  if (description.includes('linux')) return 'linux';
  return 'unknown';
}

function currentPlatformHints(): GatewayPlatformHints | null {
  if (typeof navigator === 'undefined') return null;
  return { userAgent: navigator.userAgent, platform: navigator.platform };
}

export async function resolveGatewayClientPlatform(
  readNativePlatform: () => Promise<{ os: string; arch: string }> = getNativePlatformInfo,
  hints: GatewayPlatformHints | null | undefined = currentPlatformHints(),
): Promise<GatewayClientPlatform> {
  try {
    return platformFromNativeOs((await readNativePlatform()).os);
  } catch {
    return platformFromWebView(hints);
  }
}

export function isCurrentGatewayHandshake(
  currentSocket: unknown,
  expectedSocket: unknown,
  connecting: boolean,
  currentHandshakeId: string | null,
  expectedHandshakeId: string,
): boolean {
  return currentSocket === expectedSocket
    && connecting
    && currentHandshakeId === expectedHandshakeId;
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
  /** OpenClaw run identity carried by the durable event when available. */
  runId?: string;
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
  /** Official in-flight session operation event for the selected transcript. */
  onSessionOperation?: (operation: OpenClawSessionOperationEvent) => void;
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
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
  abortCleanup: (() => void) | null;
}

interface GatewayConnectionDependencies {
  resolvePlatform: () => Promise<GatewayClientPlatform>;
  signDeviceChallenge: typeof signGatewayDeviceChallenge;
  connectTimeoutMs: number;
}

/** JSON object parameters accepted by an OpenClaw RPC request. */
export type GatewayRequestParams = object;

interface GatewayDeviceIdentity {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

export interface GatewayRequestOptions {
  /**
   * `null` keeps an interactive request open until the Gateway responds or
   * the WebSocket closes. Some official setup operations wait on a person or
   * a third-party device longer than the normal RPC timeout.
   */
  timeoutMs?: number | null;
  /** Stops awaiting this RPC locally; the remote operation is unchanged. */
  signal?: AbortSignal;
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

export class GatewayRequestAbortedError extends Error {
  readonly code = 'GATEWAY_REQUEST_ABORTED';

  constructor() {
    super('Gateway request aborted locally');
    this.name = 'GatewayRequestAbortedError';
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
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeRequestId: string | null = null;
  private runtimeIdentityConnectionId: string | null = null;
  private helloPolicy: GatewayHelloPolicy | null = null;
  private helloObservation: GatewayHelloObservation | null = null;
  private readonly helloListeners = new Set<(observation: GatewayHelloObservation | null) => void>();

  // ── Pairing detection (gentle retry instead of exponential backoff) ──
  private pairingRequired = false;
  private pairingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PAIRING_RETRY_MS = 5_000;

  // Device identity challenge facts are owned by the active socket only.
  private challengeNonce: string | null = null;
  private challengeTimestamp: number | null = null;


  // ── Server-policy activity watchdog ──
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGatewayActivityAt: number | null = null;
  private gatewayTickIntervalMs = DEFAULT_GATEWAY_TICK_INTERVAL_MS;
  private msgRouter = new MessageRouter();

  // ── Last error for diagnostics and recovery surfaces ──
  private lastError: string | null = null;
  private readonly requestedScopes: readonly GatewayOperatorScope[];
  private readonly transient: boolean;

  url = '';
  /** Explicit/shared Gateway token. Device credentials are stored separately. */
  token = '';
  deviceToken = '';
  private readonly persistDeviceCredential: (gatewayUrl: string, token: string) => Promise<unknown>;
  private readonly resolvePlatform: () => Promise<GatewayClientPlatform>;
  private readonly signDeviceChallenge: typeof signGatewayDeviceChallenge;
  private readonly connectTimeoutMs: number;

  // ── Event callback (set by ChatHandler) ──
  /** Called for every incoming non-response event from the WebSocket. */
  onEvent: (msg: unknown) => void = () => {};

  constructor(
    options: GatewayConnectionOptions = {},
    dependencies: Partial<GatewayConnectionDependencies> = {},
  ) {
    this.requestedScopes = [...new Set(options.scopes?.length ? options.scopes : DAILY_OPERATOR_SCOPES)];
    this.transient = options.transient === true;
    this.persistDeviceCredential = options.persistDeviceCredential ?? storeGatewayConnectionDeviceCredential;
    this.resolvePlatform = dependencies.resolvePlatform ?? resolveGatewayClientPlatform;
    this.signDeviceChallenge = dependencies.signDeviceChallenge ?? signGatewayDeviceChallenge;
    this.connectTimeoutMs = dependencies.connectTimeoutMs ?? GATEWAY_CONNECT_TIMEOUT_MS;
    // Register message handlers once — they never change and MessageRouter
    // uses set() semantics, so calling this in connect() would be a no-op,
    // but initializing here is the correct ownership model.
    this.initMessageRouter();
  }

  // ══════════════════════════════════════════════════════
  // Gateway Activity Watchdog
  // ══════════════════════════════════════════════════════

  private startHeartbeat(policy: GatewayHelloPolicy) {
    this.helloPolicy = policy;
    this.gatewayTickIntervalMs = policy.tickIntervalMs;
    this.lastGatewayActivityAt = Date.now();
    this.scheduleHeartbeatWatch();
  }

  private recordGatewayActivity() {
    if (!this.connected) return;
    this.lastGatewayActivityAt = Date.now();
    this.scheduleHeartbeatWatch();
  }

  private scheduleHeartbeatWatch() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (!this.connected || this.lastGatewayActivityAt === null) return;
    const intervalMs = Math.max(this.gatewayTickIntervalMs, MIN_GATEWAY_TICK_WATCH_INTERVAL_MS);
    this.heartbeatTimer = setTimeout(() => {
      if (!this.connected || this.lastGatewayActivityAt === null) return;
      const allPendingRequestsHaveTimeouts = this.pendingRequests.size > 0
        && [...this.pendingRequests.values()].every((request) => request.timer !== null);
      if (!allPendingRequestsHaveTimeouts) {
        const inactiveForMs = Date.now() - this.lastGatewayActivityAt;
        if (inactiveForMs > this.gatewayTickIntervalMs * 2) {
          debugWarn('gateway', '[GW] Gateway tick watchdog expired after', inactiveForMs, 'ms');
          this.ws?.close(4000, 'Gateway tick timeout');
          return;
        }
      }
      this.scheduleHeartbeatWatch();
    }, intervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) { clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.lastGatewayActivityAt = null;
    this.gatewayTickIntervalMs = DEFAULT_GATEWAY_TICK_INTERVAL_MS;
    this.helloPolicy = null;
  }

  /** Returns true when the WebSocket is established and handshake succeeded */
  isConnected(): boolean {
    return this.connected;
  }

  /** The attested socket identity used by requestFenced. */
  getAttestedConnectionId(): string | null {
    return this.runtimeIdentityConnectionId;
  }

  /** 当前认证 socket 的 hello 事实；连接失效时同步清除。 */
  getHelloObservation(): GatewayHelloObservation | null {
    return this.helloObservation;
  }

  subscribeHello(listener: (observation: GatewayHelloObservation | null) => void): () => void {
    this.helloListeners.add(listener);
    listener(this.helloObservation);
    return () => this.helloListeners.delete(listener);
  }

  private publishHello(observation: GatewayHelloObservation | null): void {
    if (this.helloObservation === observation) return;
    this.helloObservation = observation;
    this.helloListeners.forEach((listener) => listener(observation));
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
    this.helloPolicy = null;
    if (!this.transient) this.publishHello(null);
    this.challengeNonce = null;
    this.challengeTimestamp = null;

    this.connecting = true;
    this.lastError = null;
    this.emitStatus();

    debugLog('gateway', '[GW] Connecting:', url);

    // Capture the WS instance locally so all handlers can guard against stale
    // close/open events from a previous connection being replaced mid-flight.
    // Without this guard, disconnect() + immediate connect() causes the old
    // onclose to fire AFTER the new WS is created, setting this.ws = null and
    // this.connecting = false on the new connection before its challenge arrives.
    const ws = new WebSocket(url);
    this.ws = ws;
    this.startAttemptDeadline(ws);
    this.emitRetryState('attempting');

    ws.onopen = () => {
      if (this.ws !== ws) return; // stale — a newer connection replaced us
      debugLog('gateway', '[GW] Open — waiting for connect.challenge...');
      this.challengeNonce = null;
      this.challengeTimestamp = null;
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
      this.challengeNonce = null;
      this.challengeTimestamp = null;
      if (!this.transient) this.publishHello(null);
      if (!this.transient) this.invalidateObservedRuntimeIdentity();
      this.rejectAllPending(new GatewayTransportLifecycleError(
        event.reason || 'Gateway connection closed',
      ));
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
    this.helloPolicy = null;
    this.challengeNonce = null;
    this.challengeTimestamp = null;
    this.rejectAllPending(new GatewayTransportLifecycleError());
    this.connected = false;
    this.connecting = false;
    if (!this.transient) this.publishHello(null);
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
      this.lastError = `Gateway handshake timed out after ${this.connectTimeoutMs}ms`;
      debugWarn('gateway', `[GW] ${this.lastError}`);
      ws.close(4000, 'Gateway handshake timeout');
    }, this.connectTimeoutMs);
  }

  private clearAttemptTimers() {
    if (this.attemptTimer) { clearTimeout(this.attemptTimer); this.attemptTimer = null; }
    this.handshakeRequestId = null;
  }

  private failHandshake(
    socket: WebSocket | null,
    error: string,
    reason = 'Gateway handshake failed',
    closeCode = 4001,
  ): void {
    debugError('gateway', '[GW] Handshake failed:', error);
    this.connected = false;
    this.connecting = false;
    this.lastError = error;
    this.emitStatus({ error });
    if (socket && this.ws === socket) socket.close(closeCode, reason);
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

  private rejectAllPending(error: GatewayTransportLifecycleError) {
    const pending = [...this.pendingRequests.entries()];
    for (const [id, request] of pending) {
      this.clearPendingRequest(id, request);
      request.reject(error);
    }
  }

  private clearPendingRequest(id: string, request: PendingRequest): void {
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    request.abortCleanup?.();
    request.abortCleanup = null;
    if (this.pendingRequests.get(id) === request) this.pendingRequests.delete(id);
  }

  private isTryingToConnect(): boolean {
    return this.connecting || this.reconnectTimer !== null || this.pairingRetryTimer !== null;
  }

  // ══════════════════════════════════════════════════════
  // Handshake
  // ══════════════════════════════════════════════════════

  private async sendHandshake() {
    if (this.handshakeRequestId) return;
    const challengeNonce = this.challengeNonce;
    const challengeTimestamp = this.challengeTimestamp;
    if (!challengeNonce || challengeTimestamp === null) return;
    const id = this.nextId();
    this.handshakeRequestId = id;
    const handshakeSocket = this.ws;
    const scopes = [...this.requestedScopes];
    const clientId = 'openclaw-control-ui';
    const clientMode = 'ui';
    const sharedToken = this.token.trim();
    const storedDeviceToken = this.deviceToken.trim();
    const authToken = sharedToken || storedDeviceToken;
    const authDeviceToken = sharedToken ? '' : storedDeviceToken;

    this.registerCallback(
      id,
      {
      resolve: (response: unknown) => {
        const responseRecord = isRecord(response) ? response : null;
        if (responseRecord?.type === 'hello-ok' && !isGatewayOperatorProtocol(responseRecord.protocol)) {
          const receivedProtocol = typeof responseRecord.protocol === 'number'
            ? `v${responseRecord.protocol}`
            : 'an unknown protocol';
          this.failHandshake(
            handshakeSocket,
            `Gateway protocol mismatch: JunQi requires v${GATEWAY_OPERATOR_PROTOCOL_VERSION}, received ${receivedProtocol}`,
            'Gateway protocol mismatch',
          );
          return;
        }
        const hello = validateGatewayHello(response);
        if (!hello) {
          this.failHandshake(handshakeSocket, 'Gateway handshake returned an invalid hello-ok');
          return;
        }
        debugLog('gateway', '[GW] Connected');
        if (!this.transient) {
          const helloObservation = buildGatewayHelloObservation(this.url, hello.payload);
          this.runtimeIdentityConnectionId = helloObservation.connectionId || null;
          this.publishHello(helloObservation);
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
        if (!this.transient && hello.authDeviceToken) {
          this.deviceToken = hello.authDeviceToken;
          void this.persistDeviceCredential(this.url, hello.authDeviceToken)
            .catch(() => {});
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
        this.startHeartbeat(hello.policy);
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
      },
      reject: (err: unknown) => {
        const errStr = String(err);
        debugError('gateway', '[GW] Handshake rejected:', errStr);
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
      { timeoutMs: this.connectTimeoutMs },
    );

    // The challenge timestamp is part of the Gateway-signed device proof.
    // Match OpenClaw's client precedence: try the explicit shared token first.
    // A stored device token is sent as deviceToken only when no shared token is
    // available; a successful shared-token handshake rotates it via hello-ok.
    const platform = await this.resolvePlatform().catch((): GatewayClientPlatform => 'unknown');
    if (!isCurrentGatewayHandshake(
      this.ws,
      handshakeSocket,
      this.connecting,
      this.handshakeRequestId,
      id,
    )) return;

    let device: GatewayDeviceIdentity | undefined;
    try {
      const signed = await this.signDeviceChallenge({
        nonce: challengeNonce,
        signedAt: challengeTimestamp,
        clientId,
        clientMode,
        role: 'operator',
        scopes,
        token: authToken,
        platform,
        deviceFamily: null,
      });
      if (!isCurrentGatewayHandshake(
        this.ws,
        handshakeSocket,
        this.connecting,
        this.handshakeRequestId,
        id,
      )) return;
      if (signed.signature) {
        device = {
          id: signed.deviceId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          signedAt: signed.signedAt,
          nonce: signed.nonce,
        };
        debugLog('gateway', '[GW] Device identity attached (v3):', signed.deviceId.substring(0, 16) + '...');
      } else {
        this.failHandshake(handshakeSocket, 'Gateway device signing returned no signature');
        return;
      }
    } catch (err) {
      debugWarn('gateway', '[GW] Device identity unavailable:', err);
      this.failHandshake(handshakeSocket, 'Gateway device signing is unavailable');
      return;
    }

    if (!isCurrentGatewayHandshake(
      this.ws,
      handshakeSocket,
      this.connecting,
      this.handshakeRequestId,
      id,
    )) return;

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

  async request<T = unknown>(
    method: string,
    params: GatewayRequestParams = {},
    options?: GatewayRequestOptions,
  ): Promise<T> {
    if (!this.ws || !this.connected) {
      throw new GatewayTransportLifecycleError('Gateway is not connected');
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.nextId();
      if (!this.registerCallback(id, { resolve, reject }, options)) return;
      try {
        this.send({ type: 'req', id, method, params });
      } catch (error) {
        const pending = this.pendingRequests.get(id);
        if (pending) this.clearPendingRequest(id, pending);
        reject(error);
      }
    });
  }

  /**
   * Dispatch an identity-sensitive RPC only on the socket that produced the
   * attested connection id. JavaScript cannot interleave a reconnect between
   * the synchronous fence check and WebSocket.send; close/swap rejects the
   * pending request, and the response path verifies the fence again.
   */
  async requestFenced<T = unknown>(
    method: string,
    params: GatewayRequestParams,
    expectedConnectionId: string,
    options?: GatewayRequestOptions,
  ): Promise<T> {
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

    return new Promise<T>((resolve, reject) => {
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
      if (!this.registerCallback<T>(id, {
        resolve: (value) => {
          if (!verifyFence()) {
            reject(new GatewayConnectionFenceError(expected, this.runtimeIdentityConnectionId));
            return;
          }
          resolve(value as T);
        },
        reject: rejectFenced,
      }, options)) return;
      try {
        this.send({ type: 'req', id, method, params });
      } catch (error) {
        const pending = this.pendingRequests.get(id);
        if (pending) this.clearPendingRequest(id, pending);
        rejectFenced(error);
      }
    });
  }

  registerCallback<T>(
    id: string,
    handlers: { resolve: (v: T) => void; reject: (e: unknown) => void },
    options?: GatewayRequestOptions,
  ): boolean {
    const pending: PendingRequest = {
      // The request map stores callbacks with different declared response types.
      resolve: (value) => handlers.resolve(value as T),
      reject: handlers.reject,
      timer: null,
      abortCleanup: null,
    };
    this.pendingRequests.set(id, pending);

    const signal = options?.signal;
    if (signal) {
      const abort = () => {
        if (this.pendingRequests.get(id) !== pending) return;
        this.clearPendingRequest(id, pending);
        handlers.reject(new GatewayRequestAbortedError());
      };
      pending.abortCleanup = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) {
        abort();
        return false;
      }
      signal.addEventListener('abort', abort, { once: true });
    }

    const configuredTimeout = options?.timeoutMs;
    const timeoutMs = configuredTimeout === null
      ? null
      : Math.max(1000, configuredTimeout ?? 120_000);
    if (!this.pendingRequests.has(id)) return false;
    pending.timer = timeoutMs === null ? null : setTimeout(() => {
      if (this.pendingRequests.get(id) !== pending) return;
      this.clearPendingRequest(id, pending);
      handlers.reject(`Request timeout (${timeoutMs}ms)`);
    }, timeoutMs);
    return true;
  }

  send(msg: Record<string, unknown>) {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new GatewayTransportLifecycleError('Gateway is not connected');
    }
    const serialized = JSON.stringify(msg);
    const policy = this.helloPolicy;
    if (policy) {
      const payloadBytes = new TextEncoder().encode(serialized).byteLength;
      if (payloadBytes > policy.maxPayload) {
        throw new GatewayTransportLifecycleError('Gateway request exceeds the server payload limit');
      }
      if (socket.bufferedAmount > policy.maxBufferedBytes) {
        throw new GatewayTransportLifecycleError('Gateway send buffer exceeds the server limit');
      }
    }
    socket.send(serialized);
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
      // connect.challenge owns both nonce and signing timestamp for this socket.
      .on('event', (msg) => {
        if (!this.connecting || this.handshakeRequestId) return;
        const payload = isRecord(msg.payload) ? msg.payload : null;
        const nonce = payload?.nonce;
        const timestamp = payload?.ts;
        if (!isNonEmptyString(nonce) || !isNonNegativeSafeInteger(timestamp)) {
          this.failHandshake(
            this.ws,
            'Gateway connect challenge is invalid',
            'Gateway connect challenge invalid',
            1008,
          );
          return;
        }
        debugLog('gateway', '[GW] Received connect.challenge');
        this.challengeNonce = nonce;
        this.challengeTimestamp = timestamp;
        void this.sendHandshake();
      }, 'connect.challenge')
      // Response — resolve/reject pending requests
      .on('res', (msg) => {
        if (!msg.id) return;
        const pending = this.pendingRequests.get(msg.id);
        if (!pending) return;
        this.clearPendingRequest(msg.id, pending);
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

  private handleMessage(msg: unknown) {
    if (
      isRecord(msg)
      && ((msg.type === 'event' && typeof msg.event === 'string')
        || (msg.type === 'res' && typeof msg.id === 'string' && typeof msg.ok === 'boolean'))
    ) this.recordGatewayActivity();
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
        debugLog('gateway', '[GW] Pairing retry...');
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
    debugLog('gateway', '[GW] Reconnecting with new token');
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
    this.rejectAllPending(new GatewayTransportLifecycleError(
      'Gateway credentials changed',
      'credentials-changed',
    ));
    this.token = newToken;
    setTimeout(() => this.connect(this.url, newToken, this.deviceToken), 300);
  }

}
