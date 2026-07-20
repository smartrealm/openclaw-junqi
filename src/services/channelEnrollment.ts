import { invoke } from '@tauri-apps/api/core';

export type ChannelEnrollmentPhase = 'idle' | 'preparing' | 'waiting' | 'connected' | 'denied' | 'expired' | 'error' | 'cancelled';

export interface ChannelEnrollmentState {
  phase: ChannelEnrollmentPhase;
  qrDataUrl: string | null;
  qrContent?: string | null;
  error: string;
}

export interface ChannelEnrollmentCompletion {
  sessionId: string;
  channel: 'feishu';
  domain: 'feishu' | 'lark';
}

interface ChannelEnrollmentSnapshot {
  sessionId?: unknown;
  channel?: unknown;
  phase?: unknown;
  qrDataUrl?: unknown;
  qrContent?: unknown;
  pollAfterMs?: unknown;
  domain?: unknown;
}

type StateListener = (state: ChannelEnrollmentState) => void;

const DEFAULT_POLL_DELAY_MS = 5_000;
const MIN_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 60_000;

export function safeChannelEnrollmentQrDataUrl(value: unknown): string | null {
  return typeof value === 'string'
    && /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

function asRecord(value: unknown): ChannelEnrollmentSnapshot {
  return value && typeof value === 'object' ? value as ChannelEnrollmentSnapshot : {};
}

function normalizedDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_POLL_DELAY_MS;
  return Math.max(MIN_POLL_DELAY_MS, Math.min(MAX_POLL_DELAY_MS, Math.round(value)));
}

function enrollmentFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('unsupported_verification_host')) return 'unsupported_verification_host';
  if (message.includes('network') || message.includes('connect') || message.includes('timeout')) return 'network_failed';
  if (message.includes('rate') || message.includes('429')) return 'rate_limited';
  if (message.includes('rejected') || message.includes('invalid')) return 'provider_rejected';
  return 'start_failed';
}

function completionFrom(snapshot: ChannelEnrollmentSnapshot): ChannelEnrollmentCompletion | null {
  if (typeof snapshot.sessionId !== 'string' || snapshot.channel !== 'feishu') return null;
  if (snapshot.domain !== 'feishu' && snapshot.domain !== 'lark') return null;
  return {
    sessionId: snapshot.sessionId,
    channel: 'feishu',
    domain: snapshot.domain,
  };
}

/**
 * Renderer-side state machine for an independently polled provider enrollment.
 * It never performs a long Gateway RPC, so an upstream scan can remain active
 * for its full provider-defined lifetime without invalidating the wizard.
 */
export class ChannelEnrollmentSession {
  private generation = 0;
  private listeners = new Set<StateListener>();
  private sessionId: string | null = null;
  private completion: ChannelEnrollmentCompletion | null = null;
  private state: ChannelEnrollmentState = {
    phase: 'idle',
    qrDataUrl: null,
    error: '',
  };

  constructor(
    private readonly channel: 'feishu',
    private readonly domain: 'feishu' | 'lark',
  ) {}

  snapshot(): ChannelEnrollmentState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  takeCompletion(): ChannelEnrollmentCompletion | null {
    return this.completion;
  }

  async start(): Promise<void> {
    const priorSessionId = this.sessionId;
    const generation = ++this.generation;
    this.sessionId = null;
    this.completion = null;
    if (priorSessionId) {
      void invoke('cancel_channel_enrollment', { sessionId: priorSessionId }).catch(() => {});
    }
    this.publish({ phase: 'preparing', qrDataUrl: null, error: '' });
    try {
      const snapshot = asRecord(await invoke('start_channel_enrollment', {
        channel: this.channel,
        domain: this.domain,
      }));
      if (!this.isCurrent(generation)) return;
      if (typeof snapshot.sessionId !== 'string' || !snapshot.sessionId) {
        throw new Error('invalid_enrollment_session');
      }
      this.sessionId = snapshot.sessionId;
      this.applySnapshot(generation, snapshot);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.publish({ phase: 'error', qrDataUrl: null, error: enrollmentFailureCode(error) });
      }
    }
  }

  dispose(): void {
    const sessionId = this.sessionId;
    this.generation += 1;
    this.sessionId = null;
    if (sessionId && this.state.phase !== 'connected') {
      void invoke('cancel_channel_enrollment', { sessionId }).catch(() => {});
    }
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionId;
    this.generation += 1;
    this.sessionId = null;
    this.completion = null;
    if (sessionId) {
      await invoke('cancel_channel_enrollment', { sessionId }).catch(() => {});
    }
    this.publish({ phase: 'cancelled', qrDataUrl: null, error: '' });
  }

  private async poll(generation: number, delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    if (!this.isCurrent(generation) || !this.sessionId) return;
    try {
      const snapshot = asRecord(await invoke('poll_channel_enrollment', { sessionId: this.sessionId }));
      if (!this.isCurrent(generation)) return;
      this.applySnapshot(generation, snapshot);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.publish({ phase: 'error', qrDataUrl: null, error: enrollmentFailureCode(error) });
      }
    }
  }

  private applySnapshot(generation: number, snapshot: ChannelEnrollmentSnapshot): void {
    const phase = snapshot.phase;
    if (phase === 'waiting') {
      const qrDataUrl = safeChannelEnrollmentQrDataUrl(snapshot.qrDataUrl);
      const qrContent = typeof snapshot.qrContent === 'string' && snapshot.qrContent.startsWith('https://')
        ? snapshot.qrContent
        : null;
      if (!qrDataUrl) {
        this.publish({ phase: 'error', qrDataUrl: null, error: 'qr_unavailable' });
        return;
      }
      this.publish({ phase: 'waiting', qrDataUrl, qrContent, error: '' });
      void this.poll(generation, normalizedDelay(snapshot.pollAfterMs));
      return;
    }
    if (phase === 'connected') {
      const completion = completionFrom(snapshot);
      if (!completion) {
        this.publish({ phase: 'error', qrDataUrl: null, error: 'invalid_completion' });
        return;
      }
      this.completion = completion;
      this.publish({ phase: 'connected', qrDataUrl: null, error: '' });
      return;
    }
    if (phase === 'denied' || phase === 'expired') {
      this.publish({ phase, qrDataUrl: null, error: '' });
      return;
    }
    this.publish({ phase: 'error', qrDataUrl: null, error: 'provider_failed' });
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private publish(state: ChannelEnrollmentState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export async function completeChannelEnrollment(sessionId: string): Promise<void> {
  await invoke('complete_channel_enrollment', { sessionId });
}

export async function cancelChannelEnrollment(sessionId: string): Promise<void> {
  await invoke('cancel_channel_enrollment', { sessionId }).catch(() => {});
}

export async function readChannelEnrollmentCredential(
  sessionId: string,
  credential: 'appId' | 'appSecret',
): Promise<string> {
  const value = await invoke<unknown>('read_channel_enrollment_credential', { sessionId, credential });
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('missing_enrollment_credential');
  }
  return value;
}
