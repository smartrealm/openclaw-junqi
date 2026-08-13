// ═══════════════════════════════════════════════════════════
// GatewayConnection —— 纯传输层
// 只负责 WebSocket 生命周期、心跳、请求响应、握手与配对。
// 业务轮询和界面投影由上层组合边界管理。
// ═══════════════════════════════════════════════════════════
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
  GatewayRequestTimeoutError,
  GatewayTransportLifecycleError,
} from './GatewayTransportError';
import {
  buildGatewayHelloObservation,
  invalidateGatewayRuntimeIdentity,
  observeGatewayHello,
} from './runtimeIdentity';
import { storeGatewayConnectionDeviceCredential } from './GatewayConnectionTargetResolver';
import { signGatewayDeviceChallenge } from './deviceAuthentication';
import { getNativePlatformInfo } from '@/api/tauri-commands';
import {
  GatewayCapabilityRegistry,
  type GatewayCapabilityEvidence,
  type GatewayCapabilitySnapshot,
} from './GatewayCapabilityRegistry';
import {
  DAILY_OPERATOR_SCOPES,
  GatewayConnectionPolicy,
  type GatewayAttachmentPolicy,
  type GatewayOperatorScope,
} from './GatewayConnectionPolicy';

// OpenClaw 为 node/probe 客户端保留 v3 兼容，JunQi 作为 operator/UI 客户端使用 v4。
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

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

interface ValidatedGatewayHello {
  payload: Record<string, unknown>;
  methods: string[];
  authDeviceToken: string | null;
  policy: GatewayConnectionPolicy;
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
  const connectionPolicy = GatewayConnectionPolicy.parse(policy);
  if (!connectionPolicy) return null;
  return {
    payload: value,
    methods: features.methods,
    authDeviceToken: isNonEmptyString(auth.deviceToken) ? auth.deviceToken : null,
    policy: connectionPolicy,
  };
}
export interface GatewayConnectionOptions {
  scopes?: readonly GatewayOperatorScope[];
  /** 仅服务一次操作的连接，不持有全局轮询或运行时身份。 */
  transient?: boolean;
  /** 非临时连接完成握手后持久化轮换的设备凭据。 */
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
  currentSocket: WebSocket | null,
  expectedSocket: WebSocket | null,
  connecting: boolean,
  currentHandshakeId: string | null,
  expectedHandshakeId: string,
): boolean {
  return currentSocket === expectedSocket
    && expectedSocket !== null
    && expectedSocket.readyState === WebSocket.OPEN
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
}

export interface GatewayCallbacks {
  onMessage: (msg: ChatMessage) => void;
  onStreamChunk: (sessionKey: string, messageId: string, content: string, media?: MediaInfo, runId?: string | null) => void;
  onStreamEnd: (sessionKey: string, messageId: string, content: string, media?: MediaInfo, meta?: StreamEndMeta) => void;
  /** 重连后从 OpenClaw sessions.list 读取的权威运行状态。 */
  onSessionRunReconciliation?: (resolution: GatewaySessionRunReconciliation) => void;
  /** 运行序号出现缺口时，必须刷新持久历史后才能信任实时文本。 */
  onStreamReconciliationNeeded?: (sessionKey: string, runId: string) => void;
  /** 持久转录快照无法绑定到本地活动运行。 */
  onSessionRunReconciliationNeeded?: (sessionKey: string) => void;
  /** 官方 `session.message` 通知已改变持久转录。 */
  onTranscriptChanged?: (sessionKey: string) => void;
  /** 持久转录消息仅更新未读与会话投影，不作为通知来源。 */
  onTranscriptMessage?: (notice: GatewayTranscriptMessageNotice) => void;
  onStatusChange: (status: { connected: boolean; connecting: boolean; error?: string }) => void;
  onRetryState?: (state: GatewayRetryState) => void;
  /** Gateway 协议返回的结构化授权失败。 */
  onAuthorizationIssue?: (issue: GatewayAuthorizationIssue) => void;
  /** 重新配对成功并收到 token 后触发。 */
  onPairingComplete?: (token: string) => void;
  /** 本地运行时认证前经过规范化的 hello-ok 事实。 */
  onHello?: (observation: GatewayHelloObservation) => void;
  /** 交叉核验后的 Gateway 身份；socket 失效时为 null。 */
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
  attestRuntimeIdentity: (observation: GatewayHelloObservation) => Promise<RuntimeIdentity | null>;
  invalidateRuntimeIdentity: (connectionId: string) => Promise<boolean>;
  connectTimeoutMs: number;
  pairingRetryMs: number;
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

class GatewayConnectionTarget {
  constructor(
    readonly url: string,
    readonly token: string,
    readonly deviceToken: string,
  ) {}

  equals(other: GatewayConnectionTarget): boolean {
    return this.url === other.url
      && this.token === other.token
      && this.deviceToken === other.deviceToken;
  }

  withToken(token: string): GatewayConnectionTarget {
    return new GatewayConnectionTarget(this.url, token, this.deviceToken);
  }

  withDeviceToken(deviceToken: string): GatewayConnectionTarget {
    return new GatewayConnectionTarget(this.url, this.token, deviceToken);
  }
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
  private pendingRuntimeIdentityConnectionId: string | null = null;
  private runtimeIdentityHandshakeFailure: {
    connectionId: string;
    diagnostic: string;
  } | null = null;
  private readonly runtimeIdentityFailureListeners = new Set<(
    failure: { connectionId: string; diagnostic: string } | null,
  ) => void>();
  private helloPolicy: GatewayConnectionPolicy | null = null;
  private helloObservation: GatewayHelloObservation | null = null;
  private readonly helloListeners = new Set<(observation: GatewayHelloObservation | null) => void>();
  private readonly retryStateListeners = new Set<(state: GatewayRetryState) => void>();
  private retryState: GatewayRetryState;
  private readonly capabilityRegistry = new GatewayCapabilityRegistry();

  // 配对等待采用固定间隔，不进入普通指数退避。
  private pairingRequired = false;
  private pairingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private pairingGeneration = 0;
  private pairingAttempt: { generation: number; socket: WebSocket } | null = null;
  private readonly pairingRetryMs: number;

  // 设备身份挑战事实只属于当前活动 socket。
  private challengeNonce: string | null = null;
  private challengeTimestamp: number | null = null;


  // 服务端策略驱动的活动看门狗。
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGatewayActivityAt: number | null = null;
  private gatewayTickIntervalMs = DEFAULT_GATEWAY_TICK_INTERVAL_MS;
  private msgRouter = new MessageRouter();

  // 最近一次错误只用于诊断和恢复界面。
  private lastError: string | null = null;
  private readonly requestedScopes: readonly GatewayOperatorScope[];
  private readonly transient: boolean;

  private target = new GatewayConnectionTarget('', '', '');

  get url(): string {
    return this.target.url;
  }

  get token(): string {
    return this.target.token;
  }

  get deviceToken(): string {
    return this.target.deviceToken;
  }
  private readonly persistDeviceCredential: (gatewayUrl: string, token: string) => Promise<unknown>;
  private readonly resolvePlatform: () => Promise<GatewayClientPlatform>;
  private readonly signDeviceChallenge: typeof signGatewayDeviceChallenge;
  private readonly attestRuntimeIdentity: GatewayConnectionDependencies['attestRuntimeIdentity'];
  private readonly invalidateRuntimeIdentity: GatewayConnectionDependencies['invalidateRuntimeIdentity'];
  private readonly connectTimeoutMs: number;

  // ChatHandler 注入的非响应事件回调。
  /** 每个 WebSocket 非响应事件都会调用。 */
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
    this.attestRuntimeIdentity = dependencies.attestRuntimeIdentity ?? observeGatewayHello;
    this.invalidateRuntimeIdentity = dependencies.invalidateRuntimeIdentity
      ?? invalidateGatewayRuntimeIdentity;
    this.connectTimeoutMs = dependencies.connectTimeoutMs ?? GATEWAY_CONNECT_TIMEOUT_MS;
    this.pairingRetryMs = dependencies.pairingRetryMs ?? 5_000;
    this.retryState = {
      phase: 'idle',
      attempt: 0,
      maxAttempts: this.retryPolicy.maxAttempts,
    };
    // 消息处理器由连接实例持有且保持不变，因此只在构造阶段注册一次。
    this.initMessageRouter();
  }

  // ══════════════════════════════════════════════════════
  // Gateway Activity Watchdog
  // ══════════════════════════════════════════════════════

  private startHeartbeat(policy: GatewayConnectionPolicy) {
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

  /** WebSocket 已建立且握手成功时返回 true。 */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** requestFenced 使用的已认证 socket 身份。 */
  getAttestedConnectionId(): string | null {
    return this.runtimeIdentityConnectionId;
  }

  /** 仅暴露当前活动握手正在核验的连接标识，供失败收敛使用。 */
  getPendingRuntimeIdentityConnectionId(): string | null {
    return this.pendingRuntimeIdentityConnectionId;
  }

  /** 返回当前显式连接轮次中可回放的身份核验终态失败。 */
  getRuntimeIdentityHandshakeFailure(): { connectionId: string; diagnostic: string } | null {
    return this.runtimeIdentityHandshakeFailure;
  }

  subscribeRuntimeIdentityHandshakeFailure(
    listener: (failure: { connectionId: string; diagnostic: string } | null) => void,
  ): () => void {
    this.runtimeIdentityFailureListeners.add(listener);
    return () => this.runtimeIdentityFailureListeners.delete(listener);
  }

  /** 当前认证 socket 的 hello 事实；连接失效时同步清除。 */
  getHelloObservation(): GatewayHelloObservation | null {
    return this.helloObservation;
  }

  /** 返回当前已认证 socket 的附件与帧限制。 */
  getAttachmentPolicy(): GatewayAttachmentPolicy | null {
    return this.helloPolicy?.attachmentPolicy() ?? null;
  }

  subscribeHello(listener: (observation: GatewayHelloObservation | null) => void): () => void {
    this.helloListeners.add(listener);
    return () => this.helloListeners.delete(listener);
  }

  /** 订阅传输层重试事实，供统一连接收敛层提前报告权威失败。 */
  subscribeRetryState(listener: (state: GatewayRetryState) => void): () => void {
    this.retryStateListeners.add(listener);
    listener(this.retryState);
    return () => this.retryStateListeners.delete(listener);
  }

  /** 返回当前认证 socket 的能力证据；hello 方法列表只能作为保守发现信息。 */
  getCapabilitySnapshot(): GatewayCapabilitySnapshot {
    return this.capabilityRegistry.snapshot();
  }

  getCapabilityEvidence(method: string): GatewayCapabilityEvidence | null {
    return this.capabilityRegistry.get(method);
  }

  recordCapabilityInvalidResponse(method: string, code?: string): void {
    this.capabilityRegistry.recordInvalidResponse(method, code);
  }

  private publishHello(observation: GatewayHelloObservation | null): void {
    if (this.helloObservation === observation) return;
    this.helloObservation = observation;
    this.capabilityRegistry.observeHello(observation);
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
    const nextTarget = new GatewayConnectionTarget(url, token, deviceToken);
    const sameTarget = this.target.equals(nextTarget);
    if (sameTarget && this.ws && (this.connected || this.connecting)) return;
    if (!sameTarget || this.ws) {
      this.clearTransport(new GatewayTransportLifecycleError(
        sameTarget ? 'Gateway connection closed' : 'Gateway connection target changed',
        sameTarget ? 'closed' : 'target-changed',
      ));
    }
    this.target = nextTarget;
    if (resetReconnectAttempts) this.publishRuntimeIdentityHandshakeFailure(null);
    resetReconnectAttempts ? this.retryPolicy.begin() : this.retryPolicy.beginRetry();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.helloPolicy = null;
    if (!this.transient) this.publishHello(null);
    this.challengeNonce = null;
    this.challengeTimestamp = null;

    this.connecting = true;
    this.lastError = null;
    this.emitStatus();

    debugLog('gateway', '[GW] Connecting:', url);

    // 局部保存 socket，使所有处理器都能拒绝被新连接替代后的旧事件。
    // 这可避免旧 onclose 在新 socket 创建后清空新连接状态。
    const ws = new WebSocket(url);
    this.ws = ws;
    this.startAttemptDeadline(ws);
    this.emitRetryState('attempting');

    ws.onopen = () => {
      if (this.ws !== ws) return;
      debugLog('gateway', '[GW] Open — waiting for connect.challenge...');
      this.challengeNonce = null;
      this.challengeTimestamp = null;
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        debugError('gateway', '[GW] Parse error:', e);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      debugLog('gateway', '[GW] Closed:', event.code, event.reason);
      if (this.pairingAttempt?.socket === ws) this.pairingAttempt = null;
      this.stopHeartbeat();
      this.clearAttemptTimers();
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

      if (this.transient) {
        return;
      }

      // 配对等待使用固定间隔，其他关闭原因进入普通连接重试。
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
    this.clearTransport(new GatewayTransportLifecycleError());
    this.emitRetryState('idle');
    this.emitStatus();
  }

  private clearTransport(error: GatewayTransportLifecycleError): void {
    this.stopHeartbeat();
    this.invalidatePairingWait();
    this.clearAttemptTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
    this.helloPolicy = null;
    this.challengeNonce = null;
    this.challengeTimestamp = null;
    this.rejectAllPending(error);
    this.connected = false;
    this.connecting = false;
    if (!this.transient) this.publishHello(null);
    if (!this.transient) this.invalidateObservedRuntimeIdentity();
    if (!this.transient) this.publishRuntimeIdentityHandshakeFailure(null);
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
    const state: GatewayRetryState = {
      phase,
      attempt: extra.attempt ?? this.retryPolicy.attempt,
      maxAttempts: this.retryPolicy.maxAttempts,
      ...extra,
    };
    this.retryState = state;
    this.callbacks?.onRetryState?.(state);
    this.retryStateListeners.forEach((listener) => listener(state));
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
      resolve: async (response: unknown) => {
        // connect RPC 已被 Gateway 接受后，旧配对状态不再适用于本次握手后续阶段。
        this.completePairingAttempt(handshakeSocket);
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
        if (!this.transient) {
          const helloObservation = buildGatewayHelloObservation(this.url, hello.payload);
          this.pendingRuntimeIdentityConnectionId = helloObservation.connectionId;
          try {
            const identity = await this.attestRuntimeIdentity(helloObservation);
            if (!isCurrentGatewayHandshake(
              this.ws,
              handshakeSocket,
              this.connecting,
              this.handshakeRequestId,
              id,
            )) {
              this.invalidateRuntimeIdentityConnection(helloObservation.connectionId);
              return;
            }
            if (!identity || identity.connectionId !== helloObservation.connectionId || !identity.verified) {
              const issues = identity?.issues?.filter((issue) => issue.trim()).join(', ');
              this.publishRuntimeIdentityHandshakeFailure({
                connectionId: helloObservation.connectionId,
                diagnostic: issues || 'Gateway runtime identity attestation did not verify the current connection',
              });
              this.failHandshake(
                handshakeSocket,
                'Gateway runtime identity attestation did not verify the current connection',
                'Gateway runtime identity attestation failed',
              );
              return;
            }
            this.pendingRuntimeIdentityConnectionId = null;
            this.runtimeIdentityConnectionId = helloObservation.connectionId;
            this.publishRuntimeIdentityHandshakeFailure(null);
            this.publishHello(helloObservation);
            this.callbacks?.onHello?.(helloObservation);
            this.callbacks?.onRuntimeIdentity?.(identity);
          } catch (error) {
            if (!isCurrentGatewayHandshake(
              this.ws,
              handshakeSocket,
              this.connecting,
              this.handshakeRequestId,
              id,
            )) {
              this.invalidateRuntimeIdentityConnection(helloObservation.connectionId);
              return;
            }
            const diagnostic = error instanceof Error ? error.message : String(error);
            debugWarn('gateway', '[GW] Runtime identity attestation failed:', diagnostic);
            this.publishRuntimeIdentityHandshakeFailure({
              connectionId: helloObservation.connectionId,
              diagnostic,
            });
            this.failHandshake(
              handshakeSocket,
              `Gateway runtime identity attestation failed: ${diagnostic}`,
              'Gateway runtime identity attestation failed',
            );
            return;
          }
        }
        debugLog('gateway', '[GW] Connected');
        if (!this.transient && hello.authDeviceToken) {
          const previousDeviceToken = this.deviceToken.trim();
          this.target = this.target.withDeviceToken(hello.authDeviceToken);
          // 共享 token 已完成当前连接时，设备 token 只保留在进程内，避免首次进入
          // 工作区又为独立 Keychain 项发起授权。无共享 token 的设备认证仍需持久化。
          if (!this.token.trim() && hello.authDeviceToken !== previousDeviceToken) {
            void this.persistDeviceCredential(this.url, hello.authDeviceToken)
              .catch(() => {});
          }
        }
        this.connected = true;
        this.connecting = false;
        this.lastError = null;
        this.clearAttemptTimers();
        this.startHeartbeat(hello.policy);
        this.emitRetryState('connected');
        this.emitStatus();
        if (!this.transient) {
          // 标签和删除可能来自其他 OpenClaw 客户端；每条已连接 socket 只订阅一次，
          // 让这些变更即时传播，而不必等待下一轮轮询。
          void this.request('sessions.subscribe', {}).catch((error) => {
            debugWarn('gateway', '[GW] Unable to subscribe to session changes:', error);
          });
        }
      },
      reject: (err: unknown) => {
        // 旧 socket 被取消或替换后，其本地拒绝不得重新激活配对状态。
        if (this.ws !== handshakeSocket) return;
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

    // 挑战时间戳属于 Gateway 设备签名证明。共享 token 优先；只有共享 token 不可用时
    // 才发送已存设备 token。共享 token 握手返回的设备 token 仅保留在当前进程。
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
    if (!this.isConnected()) {
      this.capabilityRegistry.recordFailure(method, new GatewayDisconnectedError());
      throw new GatewayTransportLifecycleError('Gateway is not connected');
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.nextId();
      const resolveWithEvidence = (value: T) => {
        this.capabilityRegistry.recordSuccess(method);
        resolve(value);
      };
      const rejectWithEvidence = (error: unknown) => {
        this.capabilityRegistry.recordFailure(method, error);
        reject(error);
      };
      if (!this.registerCallback(id, {
        resolve: resolveWithEvidence,
        reject: rejectWithEvidence,
      }, options)) return;
      try {
        this.send({ type: 'req', id, method, params });
      } catch (error) {
        const pending = this.pendingRequests.get(id);
        if (pending) this.clearPendingRequest(id, pending);
        rejectWithEvidence(error);
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
      this.capabilityRegistry.recordFailure(
        method,
        new GatewayConnectionFenceError(expected, actual),
      );
      throw new GatewayConnectionFenceError(expected, actual);
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.nextId();
      const verifyFence = () => this.ws === socket
        && this.connected
        && socket.readyState === WebSocket.OPEN
        && this.runtimeIdentityConnectionId === expected;
      const rejectFenced = (error: unknown) => {
        if (!verifyFence()) {
          const fenceError = new GatewayConnectionFenceError(expected, this.runtimeIdentityConnectionId);
          this.capabilityRegistry.recordFailure(method, fenceError);
          reject(fenceError);
          return;
        }
        this.capabilityRegistry.recordFailure(method, error);
        reject(error);
      };
      if (!this.registerCallback<T>(id, {
        resolve: (value) => {
          if (!verifyFence()) {
            const fenceError = new GatewayConnectionFenceError(expected, this.runtimeIdentityConnectionId);
            this.capabilityRegistry.recordFailure(method, fenceError);
            reject(fenceError);
            return;
          }
          this.capabilityRegistry.recordSuccess(method);
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
      handlers.reject(new GatewayRequestTimeoutError(timeoutMs));
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
            if (authorizationIssue.kind === 'pairing_required') {
              this.pairingRequired = true;
              // 配对响应到达后、关闭事件到达前仍归当前配对代次所有，取消必须能截断该窗口。
              if (msg.id === this.handshakeRequestId && this.ws && !this.connected) {
                this.pairingAttempt = {
                  generation: this.pairingGeneration,
                  socket: this.ws,
                };
              }
            }
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
    this.callbacks?.onAuthorizationIssue?.(issue);
  }

  private invalidateRuntimeIdentityConnection(connectionId: string): void {
    const wasTracked = this.runtimeIdentityConnectionId === connectionId
      || this.pendingRuntimeIdentityConnectionId === connectionId;
    if (!wasTracked) return;
    if (this.runtimeIdentityConnectionId === connectionId) {
      this.runtimeIdentityConnectionId = null;
    }
    if (this.pendingRuntimeIdentityConnectionId === connectionId) {
      this.pendingRuntimeIdentityConnectionId = null;
    }
    this.callbacks?.onRuntimeIdentity?.(null);
    void this.invalidateRuntimeIdentity(connectionId).catch((error) => {
      debugWarn('gateway', '[GW] Failed to invalidate runtime identity:', error);
    });
  }

  private invalidateObservedRuntimeIdentity() {
    const connectionIds = new Set([
      this.runtimeIdentityConnectionId,
      this.pendingRuntimeIdentityConnectionId,
    ].filter((connectionId): connectionId is string => Boolean(connectionId)));
    this.runtimeIdentityConnectionId = null;
    this.pendingRuntimeIdentityConnectionId = null;
    if (connectionIds.size > 0) this.callbacks?.onRuntimeIdentity?.(null);
    connectionIds.forEach((connectionId) => {
      void this.invalidateRuntimeIdentity(connectionId).catch((error) => {
        debugWarn('gateway', '[GW] Failed to invalidate runtime identity:', error);
      });
    });
  }

  private publishRuntimeIdentityHandshakeFailure(
    failure: { connectionId: string; diagnostic: string } | null,
  ): void {
    if (
      this.runtimeIdentityHandshakeFailure?.connectionId === failure?.connectionId
      && this.runtimeIdentityHandshakeFailure?.diagnostic === failure?.diagnostic
    ) return;
    this.runtimeIdentityHandshakeFailure = failure;
    this.runtimeIdentityFailureListeners.forEach((listener) => listener(failure));
  }

  // ══════════════════════════════════════════════════════
  // Status
  // ══════════════════════════════════════════════════════

  emitStatus(extra?: { error?: string }) {
    if (extra?.error) {
      this.lastError = extra.error;
    }
    this.callbacks?.onStatusChange({
      connected: this.isConnected(),
      connecting: this.isTryingToConnect(),
      ...extra,
    });
  }

  getStatus() {
    return { connected: this.isConnected(), connecting: this.isTryingToConnect() };
  }

  /** 返回最近一次连接错误，仅用于失败诊断。 */
  getLastError(): string | null {
    return this.lastError;
  }

  /** 返回当前传输层重试事实，供迟到的连接收敛订阅恢复终态。 */
  getRetryState(): GatewayRetryState {
    return { ...this.retryState };
  }

  // ══════════════════════════════════════════════════════
  // Pairing
  // ══════════════════════════════════════════════════════

  private schedulePairingRetry() {
    if (this.pairingRetryTimer) clearTimeout(this.pairingRetryTimer);
    const generation = this.pairingGeneration;
    const timer = setTimeout(() => {
      if (this.pairingRetryTimer === timer) this.pairingRetryTimer = null;
      if (
        generation !== this.pairingGeneration
        || !this.pairingRequired
        || this.connected
        || this.connecting
      ) return;
      debugLog('gateway', '[GW] Pairing retry...');
      const previousSocket = this.ws;
      this.connect(this.url, this.token, this.deviceToken);
      if (
        generation === this.pairingGeneration
        && this.ws
        && this.ws !== previousSocket
        && this.connecting
      ) {
        this.pairingAttempt = { generation, socket: this.ws };
      }
    }, this.pairingRetryMs);
    this.pairingRetryTimer = timer;
  }

  private clearPairingWait(): void {
    this.pairingRequired = false;
    if (this.pairingRetryTimer) {
      clearTimeout(this.pairingRetryTimer);
      this.pairingRetryTimer = null;
    }
  }

  private invalidatePairingWait(): void {
    this.pairingGeneration += 1;
    this.clearPairingWait();
    this.pairingAttempt = null;
  }

  private completePairingAttempt(socket: WebSocket | null): void {
    this.clearPairingWait();
    if (socket && this.pairingAttempt?.socket === socket) this.pairingAttempt = null;
  }

  /** 取消普通连接的配对等待，并终止已发起但尚未返回的配对握手。 */
  stopPairingRetry() {
    const cancelledGeneration = this.pairingGeneration;
    const ownedAttempt = this.pairingAttempt?.generation === cancelledGeneration
      ? this.pairingAttempt
      : null;
    const pairingWasActive = this.pairingRequired
      || this.pairingRetryTimer !== null
      || ownedAttempt !== null;
    this.invalidatePairingWait();
    if (
      ownedAttempt
      && this.ws === ownedAttempt.socket
      && !this.connected
    ) {
      this.clearTransport(new GatewayTransportLifecycleError('Gateway pairing cancelled'));
    }
    if (pairingWasActive) {
      this.emitRetryState('idle');
      this.emitStatus();
    }
  }

  /** 从 WebSocket 地址派生 HTTP 基址。 */
  getHttpBaseUrl(): string {
    return this.url
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/+$/, '');
  }

  /** 配对批准后使用新 token 重连。 */
  reconnectWithToken(newToken: string) {
    debugLog('gateway', '[GW] Reconnecting with new token');
    this.clearTransport(new GatewayTransportLifecycleError(
      'Gateway credentials changed',
      'credentials-changed',
    ));
    this.retryPolicy.reset();
    const nextTarget = this.target.withToken(newToken);
    this.target = nextTarget;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.target.equals(nextTarget)) return;
      this.connect(nextTarget.url, nextTarget.token, nextTarget.deviceToken);
    }, 300);
  }

}
