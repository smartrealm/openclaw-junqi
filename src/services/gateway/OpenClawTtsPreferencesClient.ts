import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export type OpenClawTtsPreferenceMutation = 'enabled' | 'provider' | 'persona';

export interface OpenClawTtsPreferencesClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

const TTS_ENABLE_METHOD = 'tts.enable';
const TTS_DISABLE_METHOD = 'tts.disable';
const TTS_SET_PROVIDER_METHOD = 'tts.setProvider';
const TTS_SET_PERSONA_METHOD = 'tts.setPersona';

export class OpenClawTtsPreferencesUnavailableError extends Error {
  readonly code = 'OPENCLAW_TTS_PREFERENCES_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawTtsPreferencesUnavailableError';
  }
}

export class OpenClawTtsPreferencesResponseError extends Error {
  readonly code = 'OPENCLAW_TTS_PREFERENCES_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid TTS preferences response');
    this.name = 'OpenClawTtsPreferencesResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export class OpenClawTtsPreferencesClient {
  constructor(private readonly dependencies: OpenClawTtsPreferencesClientDependencies) {}

  async setEnabled(enabled: boolean): Promise<string> {
    const result = await this.request(enabled ? TTS_ENABLE_METHOD : TTS_DISABLE_METHOD, {});
    const response = result.response;
    const source = record(response);
    if (!source || source.enabled !== enabled) throw new OpenClawTtsPreferencesResponseError();
    return result.connectionId;
  }

  async setProvider(provider: string): Promise<string> {
    const value = text(provider);
    if (!value) throw new OpenClawTtsPreferencesResponseError();
    const result = await this.request(TTS_SET_PROVIDER_METHOD, { provider: value });
    const response = result.response;
    if (!text(record(response)?.provider)) throw new OpenClawTtsPreferencesResponseError();
    return result.connectionId;
  }

  async setPersona(persona: string | null): Promise<string> {
    const value = persona === null ? null : text(persona);
    if (persona !== null && !value) throw new OpenClawTtsPreferencesResponseError();
    const result = await this.request(TTS_SET_PERSONA_METHOD, value ? { persona: value } : {});
    const response = result.response;
    const responsePersona = record(response)?.persona;
    if (value ? !text(responsePersona) : responsePersona !== null) {
      throw new OpenClawTtsPreferencesResponseError();
    }
    return result.connectionId;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ response: unknown; connectionId: string }> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawTtsPreferencesUnavailableError('No attested Gateway connection is available for TTS preferences');
    }
    try {
      const response = await this.dependencies.requestFenced(method, params, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawTtsPreferencesUnavailableError('Gateway connection changed while updating TTS preferences');
      }
      return { response, connectionId };
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawTtsPreferencesUnavailableError(`The connected OpenClaw Gateway does not support ${method}`);
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawTtsPreferencesUnavailableError('No attested Gateway connection is available for TTS preferences');
      }
      throw error;
    }
  }
}
