export type ChannelQrPhase = 'idle' | 'preparing' | 'waiting' | 'connected' | 'expired' | 'error' | 'cancelled';

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

const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QR_DATA_URL_LENGTH = 16_384;
const MAX_QR_CONTENT_LENGTH = 4_096;
const QR_LOGIN_SESSION_TIMEOUT_MS = 10 * 60_000;
const MAX_GATEWAY_MESSAGE_LENGTH = 512;

interface QrResult {
  message?: string;
  qrDataUrl?: string;
  qrContent?: string;
  sessionId?: string;
  connected?: boolean;
}

type StateListener = (state: ChannelQrState) => void;

export function safeChannelQrDataUrl(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= MAX_QR_DATA_URL_LENGTH
    && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

export function safeChannelQrContent(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_QR_CONTENT_LENGTH) return null;
  try {
    const url = new URL(value);
    // These are QR payloads from a selected, locally installed OpenClaw
    // provider. They are encoded locally, never fetched by the renderer.
    return url.protocol === 'https:' || url.protocol === 'sgnl:' ? url.toString() : null;
  } catch {
    return null;
  }
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

export class ChannelQrLoginSession {
  private generation = 0;
  private deadline = 0;
  private sessionId: string | null = null;
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
    const generation = ++this.generation;
    this.deadline = Date.now() + QR_LOGIN_SESSION_TIMEOUT_MS;
    this.sessionId = null;
    this.publish({ phase: 'preparing', qrDataUrl: null, qrContent: null, message: '', error: '' });
    try {
      const result = resultRecord(await this.gateway.call('web.login.start', {
        channel: this.channelId,
        ...this.accountParams(),
        force,
        timeoutMs: 30000,
      }));
      if (!this.isCurrent(generation)) return;
      if (result.connected) {
        this.publish({ phase: 'connected', qrDataUrl: null, qrContent: null, message: safeGatewayMessage(result.message), error: '' });
        return;
      }
      const qrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      const qrContent = safeChannelQrContent(result.qrContent);
      if (!qrDataUrl && !qrContent) {
        this.publish({ phase: 'error', qrDataUrl: null, qrContent: null, message: safeGatewayMessage(result.message), error: 'qr_unavailable' });
        return;
      }
      this.sessionId = typeof result.sessionId === 'string' && result.sessionId.length <= 256
        ? result.sessionId
        : null;
      this.publish({ phase: 'waiting', qrDataUrl, qrContent, message: safeGatewayMessage(result.message), error: '' });
      await this.waitUntilConnected(generation, qrDataUrl);
    } catch {
      if (this.isCurrent(generation)) {
        this.publish({ phase: 'error', qrDataUrl: null, qrContent: null, message: '', error: 'qr_request_failed' });
      }
    }
  }

  cancel(): void {
    const sessionId = this.sessionId;
    this.generation += 1;
    this.sessionId = null;
    this.publish({ ...this.state, phase: 'cancelled', qrDataUrl: null, qrContent: null });
    void this.gateway.call('web.login.cancel', {
      channel: this.channelId,
      ...this.accountParams(),
      ...(sessionId ? { sessionId } : {}),
    }).catch(() => undefined);
  }

  private async waitUntilConnected(generation: number, initialQrDataUrl: string | null): Promise<void> {
    let currentQrDataUrl = initialQrDataUrl;
    while (this.isCurrent(generation)) {
      if (Date.now() >= this.deadline) {
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
      if (result.connected) {
        this.publish({ phase: 'connected', qrDataUrl: null, qrContent: null, message: safeGatewayMessage(result.message), error: '' });
        return;
      }
      const nextQrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      const nextQrContent = safeChannelQrContent(result.qrContent);
      if (!nextQrDataUrl && !nextQrContent) {
        this.publish({ phase: 'expired', qrDataUrl: null, qrContent: null, message: safeGatewayMessage(result.message), error: 'qr_expired' });
        return;
      }
      currentQrDataUrl = nextQrDataUrl;
      this.sessionId = typeof result.sessionId === 'string' && result.sessionId.length <= 256
        ? result.sessionId
        : this.sessionId;
      this.publish({ phase: 'waiting', qrDataUrl: currentQrDataUrl, qrContent: nextQrContent, message: safeGatewayMessage(result.message), error: '' });
    }
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
