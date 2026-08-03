import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export type OpenClawTtsAutoMode = 'off' | 'always' | 'inbound' | 'tagged';

export interface OpenClawTtsStatus {
  enabled: boolean;
  auto: OpenClawTtsAutoMode;
  provider: string;
  persona: string | null;
  providerStates: Array<{ id: string; label: string; configured: boolean }>;
  personas: Array<{ id: string; label: string; description: string; provider: string }>;
}

export interface OpenClawTtsStatusClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  hasAdvertisedMethod: (method: string) => boolean | null;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

const TTS_STATUS_METHOD = 'tts.status';

export class OpenClawTtsStatusUnavailableError extends Error {
  readonly code = 'OPENCLAW_TTS_STATUS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawTtsStatusUnavailableError';
  }
}

export class OpenClawTtsStatusResponseError extends Error {
  readonly code = 'OPENCLAW_TTS_STATUS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid TTS status response');
    this.name = 'OpenClawTtsStatusResponseError';
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

function autoMode(value: unknown): OpenClawTtsAutoMode | null {
  return value === 'off' || value === 'always' || value === 'inbound' || value === 'tagged'
    ? value
    : null;
}

function providerStates(value: unknown): OpenClawTtsStatus['providerStates'] | null {
  if (!Array.isArray(value)) return null;
  const states = value.map((item) => {
    const state = record(item);
    const id = text(state?.id);
    const label = text(state?.label);
    if (!id || !label || typeof state?.configured !== 'boolean') return null;
    return { id, label, configured: state.configured };
  });
  return states.some((state) => state === null) ? null : states as OpenClawTtsStatus['providerStates'];
}

function personas(value: unknown): OpenClawTtsStatus['personas'] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map((item) => {
    const persona = record(item);
    const id = text(persona?.id);
    const label = text(persona?.label);
    const description = text(persona?.description);
    const provider = text(persona?.provider);
    return id && label && description && provider ? { id, label, description, provider } : null;
  });
  return entries.some((entry) => entry === null) ? null : entries as OpenClawTtsStatus['personas'];
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawTtsStatus(value: unknown): OpenClawTtsStatus {
  const source = record(value);
  const provider = text(source?.provider);
  const persona = source?.persona === null ? null : text(source?.persona);
  const auto = autoMode(source?.auto);
  const states = providerStates(source?.providerStates);
  const configuredPersonas = personas(source?.personas);
  if (
    !source
    || typeof source.enabled !== 'boolean'
    || !auto
    || !provider
    || (source.persona !== null && !persona)
    || !states
    || !configuredPersonas
  ) throw new OpenClawTtsStatusResponseError();
  return { enabled: source.enabled, auto, provider, persona, providerStates: states, personas: configuredPersonas };
}

export class OpenClawTtsStatusClient {
  constructor(private readonly dependencies: OpenClawTtsStatusClientDependencies) {}

  async get(): Promise<OpenClawTtsStatus> {
    if (this.dependencies.hasAdvertisedMethod(TTS_STATUS_METHOD) === false) {
      throw new OpenClawTtsStatusUnavailableError('The connected OpenClaw Gateway does not advertise tts.status');
    }
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw new OpenClawTtsStatusUnavailableError('No attested Gateway connection is available for TTS status');
    try {
      const response = await this.dependencies.requestFenced(TTS_STATUS_METHOD, {}, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawTtsStatusUnavailableError('Gateway connection changed while reading TTS status');
      }
      return parseOpenClawTtsStatus(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawTtsStatusUnavailableError('The connected OpenClaw Gateway does not advertise tts.status');
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawTtsStatusUnavailableError('No attested Gateway connection is available for TTS status');
      }
      throw error;
    }
  }
}
