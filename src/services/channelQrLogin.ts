export type ChannelQrPhase = 'idle' | 'preparing' | 'waiting' | 'verifying' | 'connected' | 'expired' | 'error' | 'cancelled';

export interface ChannelQrState {
  phase: ChannelQrPhase;
  qrDataUrl: string | null;
  message: string;
  error: string;
}

export interface ChannelQrLoginGateway {
  start(params: Record<string, unknown>): Promise<unknown>;
  wait(params: Record<string, unknown>): Promise<unknown>;
}

export interface ChannelStatusGateway {
  status(params: Record<string, unknown>): Promise<unknown>;
}

type QrLoginOutcome = 'waiting' | 'connected';

const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QR_DATA_URL_LENGTH = 16_384;
const QR_LOGIN_SESSION_TIMEOUT_MS = 10 * 60_000;
const MAX_GATEWAY_MESSAGE_LENGTH = 512;
const MIN_PENDING_POLL_DELAY_MS = 1_000;
const CHANNEL_STATUS_ATTEMPTS = 5;
const CHANNEL_STATUS_RETRY_MS = 1_000;
const CHANNEL_STATUS_TIMEOUT_MS = 15_000;

interface QrResult {
  message?: string;
  qrDataUrl?: string;
  connected?: boolean;
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

  // 渠道级汇总只能核验默认账号，不能用其他账号的健康状态确认当前扫码账号。
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
  gateway: ChannelStatusGateway,
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
        const status = await gateway.status({
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
  if (result.connected === true) return 'connected';
  return 'waiting';
}

export class ChannelQrLoginSession {
  private generation = 0;
  private deadline = 0;
  private verificationController: AbortController | null = null;
  private listeners = new Set<StateListener>();
  private state: ChannelQrState = {
    phase: 'idle',
    qrDataUrl: null,
    message: '',
    error: '',
  };

  constructor(
    private readonly gateway: ChannelQrLoginGateway,
    channelId: string,
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
    const generation = ++this.generation;
    this.deadline = Date.now() + QR_LOGIN_SESSION_TIMEOUT_MS;
    this.publish({ phase: 'preparing', qrDataUrl: null, message: '', error: '' });
    try {
      const result = resultRecord(await this.gateway.start({
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
      const qrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      this.publish({
        phase: qrDataUrl ? 'waiting' : 'preparing',
        qrDataUrl,
        message: safeGatewayMessage(result.message),
        error: '',
      });
      await this.waitUntilConnected(generation, qrDataUrl);
    } catch {
      if (this.isCurrent(generation)) {
        this.publish({ phase: 'error', qrDataUrl: null, message: '', error: 'qr_request_failed' });
      }
    }
  }

  cancel(): void {
    this.verificationController?.abort();
    this.verificationController = null;
    this.generation += 1;
    this.publish({ ...this.state, phase: 'cancelled', qrDataUrl: null });
  }

  private async waitUntilConnected(
    generation: number,
    initialQrDataUrl: string | null,
  ): Promise<void> {
    let currentQrDataUrl = initialQrDataUrl;
    while (this.isCurrent(generation)) {
      if (Date.now() >= this.deadline) {
        this.publish({ phase: 'expired', qrDataUrl: null, message: '', error: 'qr_expired' });
        return;
      }
      const result = resultRecord(await this.gateway.wait({
        ...this.accountParams(),
        timeoutMs: 120000,
        ...(currentQrDataUrl ? { currentQrDataUrl } : {}),
      }));
      if (!this.isCurrent(generation)) return;
      const outcome = qrLoginOutcome(result);
      if (outcome === 'connected') {
        await this.publishConnected(generation, safeGatewayMessage(result.message));
        return;
      }
      const nextQrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      currentQrDataUrl = nextQrDataUrl ?? currentQrDataUrl;
      this.publish({
        phase: currentQrDataUrl ? 'waiting' : 'preparing',
        qrDataUrl: currentQrDataUrl,
        message: safeGatewayMessage(result.message),
        error: '',
      });
      if (!nextQrDataUrl) {
        await this.delayBeforeNextPoll(generation, MIN_PENDING_POLL_DELAY_MS);
      }
    }
  }

  private async publishConnected(generation: number, message: string): Promise<void> {
    if (!this.verifyConnected) {
      this.publish({ phase: 'connected', qrDataUrl: null, message, error: '' });
      return;
    }

    this.publish({
      phase: 'verifying',
      qrDataUrl: null,
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
          ? { phase: 'connected', qrDataUrl: null, message, error: '' }
          : {
              phase: 'error',
              qrDataUrl: null,
              message,
              error: 'qr_not_ready',
            },
      );
    } catch {
      if (!this.isCurrent(generation)) return;
      this.publish({
        phase: 'error',
        qrDataUrl: null,
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
