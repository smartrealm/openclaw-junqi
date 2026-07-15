export type ChannelQrPhase = 'idle' | 'preparing' | 'waiting' | 'connected' | 'expired' | 'error' | 'cancelled';

export interface ChannelQrState {
  phase: ChannelQrPhase;
  qrDataUrl: string | null;
  message: string;
  error: string;
}

export interface ChannelGatewayRpc {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

interface QrResult {
  message?: string;
  qrDataUrl?: string;
  connected?: boolean;
}

type StateListener = (state: ChannelQrState) => void;

export function safeChannelQrDataUrl(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

function resultRecord(value: unknown): QrResult {
  return value && typeof value === 'object' ? value as QrResult : {};
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
    private readonly gateway: ChannelGatewayRpc,
    private readonly accountId?: string,
  ) {}

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
    this.publish({ phase: 'preparing', qrDataUrl: null, message: '', error: '' });
    try {
      const result = resultRecord(await this.gateway.call('web.login.start', {
        ...this.accountParams(),
        force,
        timeoutMs: 30000,
      }));
      if (!this.isCurrent(generation)) return;
      if (result.connected) {
        this.publish({ phase: 'connected', qrDataUrl: null, message: result.message ?? '', error: '' });
        return;
      }
      const qrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      if (!qrDataUrl) {
        this.publish({ phase: 'error', qrDataUrl: null, message: result.message ?? '', error: 'qr_unavailable' });
        return;
      }
      this.publish({ phase: 'waiting', qrDataUrl, message: result.message ?? '', error: '' });
      await this.waitUntilConnected(generation, qrDataUrl);
    } catch (error: any) {
      if (this.isCurrent(generation)) {
        this.publish({ phase: 'error', qrDataUrl: null, message: '', error: error?.message || String(error) });
      }
    }
  }

  cancel(): void {
    this.generation += 1;
    this.publish({ ...this.state, phase: 'cancelled', qrDataUrl: null });
  }

  private async waitUntilConnected(generation: number, initialQrDataUrl: string): Promise<void> {
    let currentQrDataUrl = initialQrDataUrl;
    while (this.isCurrent(generation)) {
      const result = resultRecord(await this.gateway.call('web.login.wait', {
        ...this.accountParams(),
        timeoutMs: 120000,
        currentQrDataUrl,
      }));
      if (!this.isCurrent(generation)) return;
      if (result.connected) {
        this.publish({ phase: 'connected', qrDataUrl: null, message: result.message ?? '', error: '' });
        return;
      }
      const nextQrDataUrl = safeChannelQrDataUrl(result.qrDataUrl);
      if (!nextQrDataUrl) {
        this.publish({ phase: 'expired', qrDataUrl: null, message: result.message ?? '', error: 'qr_expired' });
        return;
      }
      currentQrDataUrl = nextQrDataUrl;
      this.publish({ phase: 'waiting', qrDataUrl: currentQrDataUrl, message: result.message ?? '', error: '' });
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
