export type ChannelQrPhase = 'idle' | 'preparing' | 'waiting' | 'pending' | 'connected' | 'error' | 'cancelled';

export type ChannelQrError = '' | 'qr_start_failed' | 'qr_wait_failed' | 'qr_invalid_response';

export interface ChannelQrState {
  phase: ChannelQrPhase;
  qrDataUrl: string | null;
  message: string;
  error: ChannelQrError;
}

export interface ChannelQrLoginGateway {
  start(params: Record<string, unknown>): Promise<unknown>;
  wait(params: Record<string, unknown>): Promise<unknown>;
}

interface QrStartResult {
  message: string;
  qrDataUrl: string | null;
  connected: boolean;
}

interface QrWaitResult {
  message: string;
  qrDataUrl: string | null;
  connected: boolean;
}

type StateListener = (state: ChannelQrState) => void;

const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QR_DATA_URL_LENGTH = 16_384;
const MAX_GATEWAY_MESSAGE_LENGTH = 512;
const QR_START_TIMEOUT_MS = 30_000;
const QR_WAIT_WINDOW_MS = 120_000;

class InvalidQrResultError extends Error {}

export function safeChannelQrDataUrl(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= MAX_QR_DATA_URL_LENGTH
    && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

function safeGatewayMessage(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\b(token|secret|password|credential)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, MAX_GATEWAY_MESSAGE_LENGTH);
}

function resultObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidQrResultError('OpenClaw QR result must be an object.');
  }
  return value as Record<string, unknown>;
}

function optionalQrDataUrl(value: unknown): string | null {
  if (value === undefined) return null;
  const qrDataUrl = safeChannelQrDataUrl(value);
  if (!qrDataUrl) {
    throw new InvalidQrResultError('OpenClaw QR result contains an invalid PNG data URL.');
  }
  return qrDataUrl;
}

function parseStartResult(value: unknown): QrStartResult {
  const result = resultObject(value);
  if (typeof result.message !== 'string') {
    throw new InvalidQrResultError('OpenClaw QR start result requires a message.');
  }
  if (result.connected !== undefined && typeof result.connected !== 'boolean') {
    throw new InvalidQrResultError('OpenClaw QR start result contains an invalid connected field.');
  }
  return {
    message: safeGatewayMessage(result.message),
    qrDataUrl: optionalQrDataUrl(result.qrDataUrl),
    connected: result.connected === true,
  };
}

function parseWaitResult(value: unknown): QrWaitResult {
  const result = resultObject(value);
  if (typeof result.message !== 'string' || typeof result.connected !== 'boolean') {
    throw new InvalidQrResultError('OpenClaw QR wait result requires message and connected fields.');
  }
  return {
    message: safeGatewayMessage(result.message),
    qrDataUrl: optionalQrDataUrl(result.qrDataUrl),
    connected: result.connected,
  };
}

export class ChannelQrLoginSession {
  private generation = 0;
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
    if (this.state.phase === 'preparing' || this.state.phase === 'waiting') return;
    const generation = ++this.generation;
    this.publish({ phase: 'preparing', qrDataUrl: null, message: '', error: '' });
    try {
      const result = parseStartResult(await this.gateway.start({
        ...this.accountParams(),
        force,
        timeoutMs: QR_START_TIMEOUT_MS,
      }));
      if (!this.isCurrent(generation)) return;
      if (result.connected) {
        this.publishConnected(result.message);
        return;
      }
      if (!result.qrDataUrl) {
        this.publish({ phase: 'pending', qrDataUrl: null, message: result.message, error: '' });
        return;
      }
      this.publish({ phase: 'waiting', qrDataUrl: result.qrDataUrl, message: result.message, error: '' });
      await this.waitWithinWindow(generation, result.qrDataUrl);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.publish({
        phase: 'error',
        qrDataUrl: null,
        message: '',
        error: error instanceof InvalidQrResultError ? 'qr_invalid_response' : 'qr_start_failed',
      });
    }
  }

  async continueWaiting(): Promise<void> {
    const qrDataUrl = this.state.qrDataUrl;
    const canContinue = this.state.phase === 'pending' || this.state.error === 'qr_wait_failed';
    if (!qrDataUrl || !canContinue) return;
    const generation = ++this.generation;
    this.publish({ ...this.state, phase: 'waiting', error: '' });
    await this.waitWithinWindow(generation, qrDataUrl);
  }

  cancel(): void {
    this.generation += 1;
    this.publish({ ...this.state, phase: 'cancelled', qrDataUrl: null });
  }

  private async waitWithinWindow(generation: number, initialQrDataUrl: string): Promise<void> {
    const startedAt = Date.now();
    let currentQrDataUrl = initialQrDataUrl;
    let didRunFinalWait = false;
    try {
      while (this.isCurrent(generation)) {
        const remainingMs = QR_WAIT_WINDOW_MS - (Date.now() - startedAt);
        if (remainingMs <= 0 && didRunFinalWait) {
          this.publishPending(currentQrDataUrl, this.state.message);
          return;
        }
        const timeoutMs = remainingMs > 0 ? remainingMs : 1;
        if (remainingMs <= 0) didRunFinalWait = true;
        const result = parseWaitResult(await this.gateway.wait({
          ...this.accountParams(),
          timeoutMs,
          currentQrDataUrl,
        }));
        if (!this.isCurrent(generation)) return;
        if (result.connected) {
          this.publishConnected(result.message);
          return;
        }
        if (!result.qrDataUrl) {
          this.publishPending(currentQrDataUrl, result.message);
          return;
        }
        currentQrDataUrl = result.qrDataUrl;
        this.publish({
          phase: 'waiting',
          qrDataUrl: currentQrDataUrl,
          message: result.message,
          error: '',
        });
        if (didRunFinalWait) {
          this.publishPending(currentQrDataUrl, result.message);
          return;
        }
      }
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.publish({
        phase: 'error',
        qrDataUrl: currentQrDataUrl,
        message: this.state.message,
        error: error instanceof InvalidQrResultError ? 'qr_invalid_response' : 'qr_wait_failed',
      });
    }
  }

  private publishPending(qrDataUrl: string, message: string): void {
    this.publish({ phase: 'pending', qrDataUrl, message, error: '' });
  }

  private publishConnected(message: string): void {
    this.publish({ phase: 'connected', qrDataUrl: null, message, error: '' });
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
