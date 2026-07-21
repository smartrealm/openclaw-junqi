export type ChannelQrPhase = 'idle' | 'preparing' | 'waiting' | 'verifying' | 'connected' | 'denied' | 'expired' | 'error' | 'cancelled';

export interface ChannelQrState {
  phase: ChannelQrPhase;
  qrDataUrl: string | null;
  qrContent: string | null;
  message: string;
  error: string;
}

export interface ChannelGatewayRpc {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

type QrLoginOutcome = 'waiting' | 'connected' | 'denied' | 'expired' | 'error';

const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QR_DATA_URL_LENGTH = 16_384;
const MAX_QR_CONTENT_LENGTH = 4_096;
const QR_LOGIN_SESSION_TIMEOUT_MS = 10 * 60_000;
const MAX_GATEWAY_MESSAGE_LENGTH = 512;
const MIN_PENDING_POLL_DELAY_MS = 1_000;
const MAX_PENDING_POLL_DELAY_MS = 60_000;
const CHANNEL_STATUS_ATTEMPTS = 5;
const CHANNEL_STATUS_RETRY_MS = 1_000;
const CHANNEL_STATUS_TIMEOUT_MS = 15_000;

interface QrResult {
  message?: string;
  qrDataUrl?: string;
  qrContent?: string;
  sessionId?: string;
  connected?: boolean;
  status?: string;
  pollAfterMs?: number;
}

type StateListener = (state: ChannelQrState) => void;
type ConnectedVerifier = (signal: AbortSignal) => Promise<boolean>;

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, delayMs);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

function statusAccountConnected(payload: unknown, channelId: string, accountId?: string): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const root = payload as Record<string, unknown>;
  const accountMap = root.channelAccounts;
  const accounts = accountMap && typeof accountMap === 'object'
    ? (accountMap as Record<string, unknown>)[channelId]
    : undefined;
  const rows = Array.isArray(accounts)
    ? accounts.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : [];
  const expectedAccountId = accountId && accountId !== 'default' ? accountId : undefined;
  const account = expectedAccountId
    ? rows.find((row) => row.accountId === expectedAccountId)
    : rows.find((row) => row.accountId === 'default') ?? rows[0];
  if (account?.connected === true) return true;
  if (account?.linked === true && account.running === true) return true;

  // A channel-level summary is only safe for the default account. Never let
  // another account's healthy status confirm the account that was scanned.
  if (expectedAccountId) return false;
  const channelMap = root.channels;
  const channel = channelMap && typeof channelMap === 'object'
    ? (channelMap as Record<string, unknown>)[channelId]
    : undefined;
  return Boolean(
    channel
    && typeof channel === 'object'
    && (channel as Record<string, unknown>).connected === true,
  );
}

export function createOfficialChannelConnectedVerifier(
  gateway: ChannelGatewayRpc,
  channelId: string,
  accountId?: string,
): ConnectedVerifier {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    throw new Error('Channel ID is invalid for status verification.');
  }
  return async (signal) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < CHANNEL_STATUS_ATTEMPTS; attempt += 1) {
      if (signal.aborted) return false;
      try {
        const status = await gateway.call('channels.status', {
          channel: channelId,
          probe: true,
          timeoutMs: CHANNEL_STATUS_TIMEOUT_MS,
        });
        if (statusAccountConnected(status, channelId, accountId)) return true;
        lastError = undefined;
      } catch (error) {
        lastError = error;
      }
      if (attempt < CHANNEL_STATUS_ATTEMPTS - 1) {
        await abortableDelay(CHANNEL_STATUS_RETRY_MS, signal);
      }
    }
    if (lastError) throw lastError;
    return false;
  };
}

export function safeChannelQrDataUrl(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= MAX_QR_DATA_URL_LENGTH
    && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

export function safeChannelQrContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const content = value.trim();
  // The Gateway advertises QR login only for the selected local provider.
  // Provider QR payloads can be URLs, deep links, or opaque device codes; the
  // desktop encodes them locally and never loads or executes their contents.
  return content.length > 0
    && content.length <= MAX_QR_CONTENT_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(content)
    ? content
    : null;
}

function safeGatewayMessage(value: unknown): string {
  return typeof value === 'string'
    ? value
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\b(token|secret|password|credential)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
      .trim()
      .slice(0, MAX_GATEWAY_MESSAGE_LENGTH)
    : '';
}

function resultRecord(value: unknown): QrResult {
  return value && typeof value === 'object' ? value as QrResult : {};
}

function qrLoginOutcome(result: QrResult): QrLoginOutcome {
  if (result.connected === true || result.status === 'connected') return 'connected';
  if (result.status === 'denied') return 'denied';
  if (result.status === 'expired') return 'expired';
  if (result.status === 'error') return 'error';
  return 'waiting';
}

function pendingPollDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MIN_PENDING_POLL_DELAY_MS;
  return Math.max(MIN_PENDING_POLL_DELAY_MS, Math.min(MAX_PENDING_POLL_DELAY_MS, Math.round(value)));
}

function validSessionId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
}

export class ChannelQrLoginSession {
  private generation = 0;
  private deadline = 0;
  private sessionId: string | null = null;
  private verificationController: AbortController | null = null;
  private listeners = new Set<StateListener>();
  private state: ChannelQrState = {
    phase: 'idle',
    qrDataUrl: null,
    qrContent: null,
    message: '',
    error: '',
  };

  constructor(
    private readonly gateway: ChannelGatewayRpc,
    private readonly channelId: string,
    private readonly accountId?: string,
    private readonly verifyConnected?: ConnectedVerifier,
  ) {
    if (!CHANNEL_ID_PATTERN.test(channelId)) {
      throw new Error('Channel ID is invalid for QR login.');
    }
  }

  snapshot(): ChannelQrState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async start(force = false): Promise<void> {
    this.verificationController?.abort();
    this.verificationController = null;
    const previousSessionId = this.sessionId;
    const generation = ++this.generation;
    this.deadline = Date.now() + QR_LOGIN_SESSION_TIMEOUT_MS;
    this.sessionId = null;
    if (previousSessionId) this.cancelProviderSession(previousSessionId);
    this.publish({ phase: 'preparing', qrDataUrl: null, qrContent: null, message: '', error: '' });
    try {
      const result = resultRecord(await this.gateway.call('web.login.start', {
        channel: this.channelId,
        ...this.accountParams(),
        force,
        timeoutMs: 30000,
      }));
      if (!this.isCurrent(generation)) return;
      const outcome = qrLoginOutcome(result);
      if (outcome === 'connected') {
        await this.publishConnected(generation, safeGatewayMessage(result.message));
        return;
      }
      if (outcome === 'denied' || outcome === 'expired') {
        this.publishTerminal(outcome, safeGatewayMessage(result.message));
        return;
      }
      if (outcome === 'error') {
        this.publish({
          phase: 'error',
          qrDataUrl: null,
          qrContent: null,
          message: safeGatewayMessage(result.message),
          error: 'qr_login_failed',
        });
        return;
      }
      const qrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      const qrContent = safeChannelQrContent(result.qrContent);
      this.sessionId = validSessionId(result.sessionId);
      this.publish({
        phase: qrDataUrl || qrContent ? 'waiting' : 'preparing',
        qrDataUrl,
        qrContent,
        message: safeGatewayMessage(result.message),
        error: '',
      });
      await this.waitUntilConnected(generation, qrDataUrl, qrContent);
    } catch {
      if (this.isCurrent(generation)) {
        if (this.sessionId) this.cancelProviderSession(this.sessionId);
        this.sessionId = null;
        this.publish({ phase: 'error', qrDataUrl: null, qrContent: null, message: '', error: 'qr_request_failed' });
      }
    }
  }

  cancel(): void {
    this.verificationController?.abort();
    this.verificationController = null;
    const sessionId = this.sessionId;
    const shouldCancelProvider = this.state.phase === 'preparing' || this.state.phase === 'waiting';
    this.generation += 1;
    this.sessionId = null;
    this.publish({ ...this.state, phase: 'cancelled', qrDataUrl: null, qrContent: null });
    if (shouldCancelProvider) this.cancelProviderSession(sessionId);
  }

  private async waitUntilConnected(
    generation: number,
    initialQrDataUrl: string | null,
    initialQrContent: string | null,
  ): Promise<void> {
    let currentQrDataUrl = initialQrDataUrl;
    let currentQrContent = initialQrContent;
    while (this.isCurrent(generation)) {
      if (Date.now() >= this.deadline) {
        if (this.sessionId) this.cancelProviderSession(this.sessionId);
        this.sessionId = null;
        this.publish({ phase: 'expired', qrDataUrl: null, qrContent: null, message: '', error: 'qr_expired' });
        return;
      }
      const result = resultRecord(await this.gateway.call('web.login.wait', {
        channel: this.channelId,
        ...this.accountParams(),
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        timeoutMs: 120000,
        currentQrDataUrl,
      }));
      if (!this.isCurrent(generation)) return;
      const outcome = qrLoginOutcome(result);
      if (outcome === 'connected') {
        await this.publishConnected(generation, safeGatewayMessage(result.message));
        return;
      }
      if (outcome === 'denied' || outcome === 'expired') {
        if (this.sessionId) this.cancelProviderSession(this.sessionId);
        this.sessionId = null;
        this.publishTerminal(outcome, safeGatewayMessage(result.message));
        return;
      }
      if (outcome === 'error') {
        if (this.sessionId) this.cancelProviderSession(this.sessionId);
        this.sessionId = null;
        this.publish({
          phase: 'error',
          qrDataUrl: null,
          qrContent: null,
          message: safeGatewayMessage(result.message),
          error: 'qr_login_failed',
        });
        return;
      }
      const nextQrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      const nextQrContent = safeChannelQrContent(result.qrContent);
      currentQrDataUrl = nextQrDataUrl ?? currentQrDataUrl;
      currentQrContent = nextQrContent ?? currentQrContent;
      this.sessionId = validSessionId(result.sessionId) ?? this.sessionId;
      this.publish({
        phase: currentQrDataUrl || currentQrContent ? 'waiting' : 'preparing',
        qrDataUrl: currentQrDataUrl,
        qrContent: currentQrContent,
        message: safeGatewayMessage(result.message),
        error: '',
      });
      if (!nextQrDataUrl && !nextQrContent) {
        await this.delayBeforeNextPoll(generation, pendingPollDelay(result.pollAfterMs));
      }
    }
  }

  private publishTerminal(outcome: Extract<QrLoginOutcome, 'denied' | 'expired'>, message: string): void {
    this.publish({
      phase: outcome,
      qrDataUrl: null,
      qrContent: null,
      message,
      error: outcome === 'expired' ? 'qr_expired' : 'qr_denied',
    });
  }

  private async publishConnected(generation: number, message: string): Promise<void> {
    if (!this.verifyConnected) {
      this.publish({ phase: 'connected', qrDataUrl: null, qrContent: null, message, error: '' });
      return;
    }

    this.publish({
      phase: 'verifying',
      qrDataUrl: null,
      qrContent: null,
      message,
      error: '',
    });
    const controller = new AbortController();
    this.verificationController = controller;
    try {
      const connected = await this.verifyConnected(controller.signal);
      if (!this.isCurrent(generation)) return;
      this.publish(
        connected
          ? { phase: 'connected', qrDataUrl: null, qrContent: null, message, error: '' }
          : {
              phase: 'error',
              qrDataUrl: null,
              qrContent: null,
              message,
              error: 'qr_not_ready',
            },
      );
    } catch {
      if (!this.isCurrent(generation)) return;
      this.publish({
        phase: 'error',
        qrDataUrl: null,
        qrContent: null,
        message,
        error: 'qr_status_failed',
      });
    } finally {
      if (this.verificationController === controller) {
        this.verificationController = null;
      }
    }
  }

  private async delayBeforeNextPoll(generation: number, delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    if (!this.isCurrent(generation)) return;
  }

  private cancelProviderSession(sessionId: string | null): void {
    void this.gateway.call('web.login.cancel', {
      channel: this.channelId,
      ...this.accountParams(),
      ...(sessionId ? { sessionId } : {}),
    }).catch(() => undefined);
  }

  private accountParams(): Record<string, string> {
    return this.accountId && this.accountId !== 'default' ? { accountId: this.accountId } : {};
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private publish(state: ChannelQrState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
