import type { VoiceWakeGatewayEventListener } from './voiceWakeEventBridge';
import {
  decodeVoiceWakeRoutingSnapshot,
  decodeVoiceWakeTriggerSnapshot,
  type VoiceWakeRoutingConfig,
  type VoiceWakeTriggerSnapshot,
} from '@/types/voiceWake';

export type VoiceWakeGatewayErrorReason =
  | 'connection_unavailable'
  | 'connection_changed'
  | 'invalid_response';

export class VoiceWakeGatewayUnavailableError extends Error {
  readonly code = 'VOICE_WAKE_GATEWAY_UNAVAILABLE';

  constructor(
    readonly reason: VoiceWakeGatewayErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceWakeGatewayUnavailableError';
  }
}

export interface VoiceWakeGatewayClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    expectedConnectionId: string,
  ) => Promise<unknown>;
  subscribe: (listener: VoiceWakeGatewayEventListener) => () => void;
}

export class VoiceWakeGatewayClient {
  constructor(private readonly dependencies: VoiceWakeGatewayClientDependencies) {}

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new VoiceWakeGatewayUnavailableError(
        'connection_unavailable',
        'No attested Gateway connection is available for voice wake',
      );
    }
    const response = await this.dependencies.requestFenced(method, params, connectionId);
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new VoiceWakeGatewayUnavailableError(
        'connection_changed',
        'Gateway connection changed while reading voice wake configuration',
      );
    }
    return response;
  }

  async getTriggers(): Promise<VoiceWakeTriggerSnapshot> {
    const response = await this.request('voicewake.get', {});
    const snapshot = decodeVoiceWakeTriggerSnapshot(response);
    if (!snapshot) {
      throw new VoiceWakeGatewayUnavailableError(
        'invalid_response',
        'Gateway returned an invalid voice wake trigger payload',
      );
    }
    return snapshot;
  }

  async setTriggers(triggers: readonly string[]): Promise<VoiceWakeTriggerSnapshot> {
    const response = await this.request('voicewake.set', { triggers: [...triggers] });
    const snapshot = decodeVoiceWakeTriggerSnapshot(response);
    if (!snapshot) {
      throw new VoiceWakeGatewayUnavailableError(
        'invalid_response',
        'Gateway returned an invalid voice wake trigger update',
      );
    }
    return snapshot;
  }

  async getRouting(): Promise<VoiceWakeRoutingConfig> {
    const response = await this.request('voicewake.routing.get', {});
    const config = decodeVoiceWakeRoutingSnapshot(response);
    if (!config) {
      throw new VoiceWakeGatewayUnavailableError(
        'invalid_response',
        'Gateway returned an invalid voice wake routing payload',
      );
    }
    return config;
  }

  subscribe(listener: VoiceWakeGatewayEventListener): () => void {
    return this.dependencies.subscribe(listener);
  }
}
