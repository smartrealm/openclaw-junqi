// ═══════════════════════════════════════════════════════════
// GatewayConnection — Transport Layer
// Handles WebSocket lifecycle, heartbeat, message queue,
// request/response, handshake, and pairing.
// No chat logic, no tool logic — pure transport.
// ═══════════════════════════════════════════════════════════

import { startPolling, stopPolling } from '@/stores/gatewayDataStore';
import { MessageRouter, isAuthError } from './messageRouter';
import { APP_VERSION } from '@/hooks/useAppVersion';
import { debugError, debugLog, debugWarn } from '@/utils/debugLog';
import i18n from '@/i18n';

// OpenClaw 2026.5.x introduced a newer WS protocol while older installs still
// negotiate protocol 3. Advertise a compatible range so Desktop can connect to
// both without pinning the bundled gateway to one exact revision.
const GATEWAY_PROTOCOL_MIN = 3;
const GATEWAY_PROTOCOL_MAX = 4;

// ── Platform Detection (cross-platform) ──
export function detectPlatform(): string {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}

// ── Locale from app language ──
export function getAppLocale(): string {
  const lang = i18n.language || 'en';
  if (lang.startsWith('ar')) return 'ar-SA';
  return 'en-US';
}

// ── Shared chat message type ──
// Defined here (not in ChatHandler) to avoid circular imports,
// since GatewayCallbacks.onMessage references it.
export interface ChatMessage {
  id: string;
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

export interface GatewayCallbacks {
  onMessage: (msg: ChatMessage) => void;
  onStreamChunk: (sessionKey: string, messageId: string, content: string, media?: MediaInfo, runId?: string | null) => void;
  onStreamEnd: (sessionKey: string, messageId: string, content: string, media?: MediaInfo, meta?: StreamEndMeta) => void;
  onStatusChange: (status: { connected: boolean; connecting: boolean; error?: string }) => void;
  /** Fired when Gateway rejects with missing scope / invalid token */
  onScopeError?: (error: string) => void;
  /** Fired after successful re-pairing (token received) */
  onPairingComplete?: (token: string) => void;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RequestOptions {
  timeoutMs?: number;
}

// ── Queued message (pre-processed: attachments in gateway format, context injected) ──
interface QueuedMessage {
  message: string;
  attachments?: any[];
  sessionKey?: string;
}

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  callbacks: GatewayCallbacks | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private msgCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnects = 10;

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

  // ── Message Queue (buffer while disconnected) ──
  private messageQueue: QueuedMessage[] = [];
  private readonly MAX_QUEUE_SIZE = 50;

  // ── Last error for diagnostics (shown in OfflineOverlay) ──
  private lastError: string | null = null;

  url = '';
  token = '';
  /** Whether Desktop context was already injected with the first outgoing message. */
  contextSent = false;

  // ── Event callback (set by ChatHandler) ──
  /** Called for every incoming non-response event from the WebSocket. */
  onEvent: (msg: any) => void = () => {};

  constructor() {
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

  // ══════════════════════════════════════════════════════
  // Message Queue Management
  // ══════════════════════════════════════════════════════

  enqueueMessage(message: string, attachments?: any[], sessionKey?: string) {
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
      debugWarn('gateway', '[GW] Queue full — dropping oldest message');
      this.messageQueue.shift();
    }
    this.messageQueue.push({ message, attachments, sessionKey });
    debugLog('gateway', '[GW] 📦 Queued message — queue size:', this.messageQueue.length);
  }

  private async flushQueue() {
    if (this.messageQueue.length === 0) return;
    debugLog('gateway', '[GW] 📤 Flushing', this.messageQueue.length, 'queued messages');
    const queued = [...this.messageQueue];
    this.messageQueue = [];
    for (const item of queued) {
      try {
        await this.request('chat.send', {
          sessionKey: item.sessionKey || 'agent:main:main',
          message: item.message,
          idempotencyKey: `aegis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...(item.attachments?.length ? { attachments: item.attachments } : {}),
        });
      } catch (err) {
        debugError('gateway', '[GW] Failed to flush queued message:', err);
        this.messageQueue.unshift(item);
        break;
      }
    }
  }

  /** Number of messages waiting in the offline queue */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  /** Returns true when the WebSocket is established and handshake succeeded */
  isConnected(): boolean {
    return this.connected;
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

  connect(url: string, token: string) {
    this.url = url;
    this.token = token;
    this.reconnectAttempt = 0;
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
    this.contextSent = false; // Reset context injection for new connection
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
      stopPolling();
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this.emitStatus();

      // Close code 1008 = pairing required (Gateway scope rejection)
      if (event.code === 1008) {
        this.pairingRequired = true;
      }

      // Pairing required — gentle retry instead of exponential backoff
      if (this.pairingRequired) {
        this.callbacks?.onScopeError?.(event.reason || 'pairing required');
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
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = this.maxReconnects;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this.emitStatus();
  }

  private scheduleReconnect() {
    if (this.reconnectAttempt >= this.maxReconnects) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;
    debugLog('gateway', `[GW] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.connect(this.url, this.token), delay);
  }

  private isTryingToConnect(): boolean {
    return this.connecting || this.reconnectTimer !== null || this.pairingRetryTimer !== null;
  }

  // ══════════════════════════════════════════════════════
  // Handshake
  // ══════════════════════════════════════════════════════

  private async sendHandshake() {
    const id = this.nextId();
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];
    const clientId = 'openclaw-control-ui';
    const clientMode = 'ui';

    this.registerCallback(
      id,
      {
      resolve: (response: any) => {
        debugLog('gateway', '[GW] Handshake response:', JSON.stringify(response).substring(0, 200));
        if (response.ok !== false && (response.payload?.type === 'hello-ok' || response.type === 'hello-ok')) {
          debugLog('gateway', '[GW] ✅ Connected!');
          const auth = response.auth || response.payload?.auth;
          if (auth?.deviceToken && window.aegis?.pairing?.saveToken) {
            window.aegis.pairing.saveToken(auth.deviceToken).catch(() => {});
          }
          this.connected = true;
          this.connecting = false;
          this.lastError = null;
          this.reconnectAttempt = 0;
          this.pairingRequired = false;
          if (this.pairingRetryTimer) {
            clearTimeout(this.pairingRetryTimer);
            this.pairingRetryTimer = null;
          }
          this.startHeartbeat();
          this.emitStatus();
          startPolling(this);
          this.flushQueue();
        } else {
          const err = response.error?.message || JSON.stringify(response);
          debugError('gateway', '[GW] ❌ Handshake failed:', err);
          this.connected = false;
          this.connecting = false;
          this.emitStatus({ error: err });
        }
      },
      reject: (err: any) => {
        const errStr = String(err);
        debugError('gateway', '[GW] ❌ Handshake rejected:', errStr);
        this.connecting = false;
        if (isAuthError({ message: errStr })) {
          this.pairingRequired = true;
        }
        this.emitStatus({ error: errStr });
      },
    },
      { timeoutMs: 120_000 },
    );

    // Build device identity if available (Electron IPC)
    // Gateway 2026.2.22+ requires v2 signatures.
    // If no challenge nonce arrived, skip device and use token-only auth.
    let device: any = undefined;
    try {
      if (window.aegis?.device?.sign && this.challengeNonce) {
        const signed = await window.aegis.device.sign({
          nonce: this.challengeNonce,
          clientId,
          clientMode,
          role: 'operator',
          scopes,
          token: this.token || '',
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
        caps: ['streaming'],
        commands: [],
        permissions: {},
        auth: { token: this.token },
        device,
        locale,
        userAgent: `aegis-desktop/${APP_VERSION} (${platform})`,
      },
    });
  }

  // ══════════════════════════════════════════════════════
  // Request / Response
  // ══════════════════════════════════════════════════════

  async request(method: string, params: any, options?: RequestOptions): Promise<any> {
    if (!this.ws || !this.connected) throw new Error('Not connected');

    return new Promise((resolve, reject) => {
      const id = this.nextId();
      this.registerCallback(id, { resolve, reject }, options);
      this.send({ type: 'req', id, method, params });
    });
  }

  registerCallback(
    id: string,
    handlers: { resolve: (v: any) => void; reject: (e: any) => void },
    options?: RequestOptions,
  ) {
    const timeoutMs = Math.max(1000, options?.timeoutMs ?? 120_000);
    const timer = setTimeout(() => {
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
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.ok !== false) {
          pending.resolve(msg.payload ?? msg);
        } else {
          const error = msg.error || {};
          const errorMsg = error.message || 'Request failed';
          if (isAuthError(error)) {
            debugWarn('gateway', '[GW] 🔑 Scope/auth error detected:', errorMsg);
            this.callbacks?.onScopeError?.(errorMsg);
          }
          pending.reject(errorMsg);
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
        this.connect(this.url, this.token);
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
    this.reconnectAttempt = 0;
    this.token = newToken;
    setTimeout(() => this.connect(this.url, newToken), 300);
  }

  /** Request pairing via Gateway HTTP API */
  async requestPairing(): Promise<{ code: string; deviceId: string }> {
    const httpUrl = this.getHttpBaseUrl();
    debugLog('gateway', '[GW] 🔑 Requesting pairing from:', httpUrl);
    const res = await fetch(`${httpUrl}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'openclaw-control-ui',
        clientName: 'JunQi Desktop',
        platform: detectPlatform(),
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
      }),
    });
    if (!res.ok) {
      throw new Error(`Pairing request failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /** Poll pairing status until approved or timeout */
  async pollPairingStatus(deviceId: string): Promise<{ status: string; token?: string }> {
    const httpUrl = this.getHttpBaseUrl();
    const res = await fetch(`${httpUrl}/v1/pair/${encodeURIComponent(deviceId)}/status`);
    if (!res.ok) {
      throw new Error(`Pairing poll failed: ${res.status}`);
    }
    return res.json();
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
