import type { VoiceWakeGatewayEventListener } from './voiceWakeEventBridge';
import {
  decodeVoiceWakeRoutingSnapshot,
  decodeVoiceWakeTriggerSnapshot,
  type VoiceWakeRoutingConfig,
  type VoiceWakeTriggerSnapshot,
} from './voiceWakeTypes';

export class VoiceWakeGatewayUnavailableError extends Error {
  readonly code = 'VOICE_WAKE_GATEWAY_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'VoiceWakeGatewayUnavailableError';
  }
}

export interface VoiceWakeGatewayConfiguration {
  triggers: VoiceWakeTriggerSnapshot;
  routing: VoiceWakeRoutingConfig;
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
      throw new VoiceWakeGatewayUnavailableError('No attested Gateway connection is available for voice wake');
    }
    const response = await this.dependencies.requestFenced(method, params, connectionId);
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new VoiceWakeGatewayUnavailableError('Gateway connection changed while reading voice wake configuration');
    }
    return response;
  }

  async getTriggers(): Promise<VoiceWakeTriggerSnapshot> {
    const response = await this.request('voicewake.get', {});
    const snapshot = decodeVoiceWakeTriggerSnapshot(response);
    if (!snapshot) {
      throw new VoiceWakeGatewayUnavailableError('Gateway returned an invalid voice wake trigger payload');
    }
    return snapshot;
  }

  async setTriggers(triggers: readonly string[]): Promise<VoiceWakeTriggerSnapshot> {
    const response = await this.request('voicewake.set', { triggers: [...triggers] });
    const snapshot = decodeVoiceWakeTriggerSnapshot(response);
    if (!snapshot) {
      throw new VoiceWakeGatewayUnavailableError('Gateway returned an invalid voice wake trigger update');
    }
    return snapshot;
  }

  async getRouting(): Promise<VoiceWakeRoutingConfig> {
    const response = await this.request('voicewake.routing.get', {});
    const config = decodeVoiceWakeRoutingSnapshot(response);
    if (!config) {
      throw new VoiceWakeGatewayUnavailableError('Gateway returned an invalid voice wake routing payload');
    }
    return config;
  }

  async getConfiguration(): Promise<VoiceWakeGatewayConfiguration> {
    const [triggers, routing] = await Promise.all([this.getTriggers(), this.getRouting()]);
    return { triggers, routing };
  }

  subscribe(listener: VoiceWakeGatewayEventListener): () => void {
    return this.dependencies.subscribe(listener);
  }
}
