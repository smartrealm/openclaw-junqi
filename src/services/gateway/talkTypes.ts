export type TalkMode = 'realtime' | 'stt-tts' | 'transcription';
export type TalkTransport = 'webrtc' | 'provider-websocket' | 'gateway-relay' | 'managed-room';
export type TalkBrain = 'agent-consult' | 'direct-tools' | 'none';

export interface TalkAudioFormat {
  encoding: 'pcm16' | 'g711_ulaw';
  sampleRateHz: number;
  channels: number;
}

export interface TalkProviderCatalogEntry {
  id: string;
  label: string;
  configured: boolean;
  modes?: TalkMode[];
  transports?: TalkTransport[];
  brains?: TalkBrain[];
  inputAudioFormats?: TalkAudioFormat[];
  outputAudioFormats?: TalkAudioFormat[];
  supportsBargeIn?: boolean;
  supportsToolCalls?: boolean;
}

export interface TalkProviderGroup {
  ready?: boolean;
  activeProvider?: string;
  providers: TalkProviderCatalogEntry[];
}

export interface TalkCatalog {
  modes: TalkMode[];
  transports: TalkTransport[];
  brains: TalkBrain[];
  speech: TalkProviderGroup;
  transcription: TalkProviderGroup;
  realtime: TalkProviderGroup;
}

export interface TalkSession {
  sessionId: string;
  provider: string | null;
}

export interface TalkEvent {
  id: string;
  type: string;
  sessionId: string;
  turnId: string | null;
  seq: number;
  mode: TalkMode;
  transport: TalkTransport;
  brain: TalkBrain;
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown, max = 512): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

const MODES = ['realtime', 'stt-tts', 'transcription'] as const;
const TRANSPORTS = ['webrtc', 'provider-websocket', 'gateway-relay', 'managed-room'] as const;
const BRAINS = ['agent-consult', 'direct-tools', 'none'] as const;

function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  const decoded: T[] = [];
  for (const item of value) {
    const parsed = enumValue(item, allowed);
    if (!parsed) return null;
    decoded.push(parsed);
  }
  return decoded;
}

function optionalEnumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined | null {
  if (value === undefined) return undefined;
  return enumArray(value, allowed);
}

function audioFormats(value: unknown): TalkAudioFormat[] | null {
  if (!Array.isArray(value)) return null;
  const decoded: TalkAudioFormat[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const encoding = enumValue(item.encoding, ['pcm16', 'g711_ulaw'] as const);
    const sampleRateHz = item.sampleRateHz;
    const channels = item.channels;
    if (!encoding || typeof sampleRateHz !== 'number' || !Number.isInteger(sampleRateHz)
      || sampleRateHz < 1 || typeof channels !== 'number'
      || !Number.isInteger(channels) || channels < 1) return null;
    decoded.push({ encoding, sampleRateHz, channels });
  }
  return decoded;
}

function optionalAudioFormats(value: unknown): TalkAudioFormat[] | undefined | null {
  if (value === undefined) return undefined;
  return audioFormats(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const decoded: string[] = [];
  for (const item of value) {
    const parsed = string(item);
    if (!parsed) return null;
    decoded.push(parsed);
  }
  return decoded;
}

function optionalStringArray(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  return stringArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : null;
}

function decodeProvider(value: unknown): TalkProviderCatalogEntry | null {
  if (!isRecord(value)) return null;
  const id = string(value.id);
  const label = string(value.label);
  const modes = optionalEnumArray(value.modes, MODES);
  const transports = optionalEnumArray(value.transports, TRANSPORTS);
  const brains = optionalEnumArray(value.brains, BRAINS);
  const inputAudioFormats = optionalAudioFormats(value.inputAudioFormats);
  const outputAudioFormats = optionalAudioFormats(value.outputAudioFormats);
  const aliases = optionalStringArray(value.aliases);
  const models = optionalStringArray(value.models);
  const voices = optionalStringArray(value.voices);
  const supportsBargeIn = optionalBoolean(value.supportsBargeIn);
  const supportsToolCalls = optionalBoolean(value.supportsToolCalls);
  if (!id || !label || typeof value.configured !== 'boolean'
    || modes === null || transports === null || brains === null
    || inputAudioFormats === null || outputAudioFormats === null
    || aliases === null || models === null || voices === null
    || supportsBargeIn === null || supportsToolCalls === null) return null;
  return {
    id,
    label,
    configured: value.configured,
    ...(modes === undefined ? {} : { modes }),
    ...(transports === undefined ? {} : { transports }),
    ...(brains === undefined ? {} : { brains }),
    ...(inputAudioFormats === undefined ? {} : { inputAudioFormats }),
    ...(outputAudioFormats === undefined ? {} : { outputAudioFormats }),
    ...(supportsBargeIn === undefined ? {} : { supportsBargeIn }),
    ...(supportsToolCalls === undefined ? {} : { supportsToolCalls }),
  };
}

function decodeProviderGroup(value: unknown): TalkProviderGroup | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) return null;
  const ready = optionalBoolean(value.ready);
  const activeProvider = value.activeProvider === undefined ? undefined : string(value.activeProvider);
  if (ready === null || activeProvider === null) return null;
  const providers: TalkProviderCatalogEntry[] = [];
  for (const rawProvider of value.providers) {
    const provider = decodeProvider(rawProvider);
    if (!provider) return null;
    providers.push(provider);
  }
  return {
    ...(ready === undefined ? {} : { ready }),
    ...(activeProvider === undefined ? {} : { activeProvider }),
    providers,
  };
}

export function decodeTalkCatalog(value: unknown): TalkCatalog | null {
  if (!isRecord(value)) return null;
  const modes = enumArray(value.modes, MODES);
  const transports = enumArray(value.transports, TRANSPORTS);
  const brains = enumArray(value.brains, BRAINS);
  const speech = decodeProviderGroup(value.speech);
  const transcription = decodeProviderGroup(value.transcription);
  const realtime = decodeProviderGroup(value.realtime);
  if (!modes || !transports || !brains || !speech || !transcription || !realtime) return null;
  return { modes, transports, brains, speech, transcription, realtime };
}

export function selectRealtimeRelayProvider(catalog: TalkCatalog): TalkProviderCatalogEntry | null {
  if (catalog.realtime.ready !== true) return null;
  return catalog.realtime.providers.find((provider) => (
    provider.configured
    && provider.modes?.includes('realtime')
    && provider.transports?.includes('gateway-relay')
    && provider.brains?.includes('agent-consult')
    && provider.supportsBargeIn === true
    && provider.inputAudioFormats?.some((format) => format.encoding === 'pcm16' && format.sampleRateHz === 24_000 && format.channels === 1)
    && provider.outputAudioFormats?.some((format) => format.encoding === 'pcm16' && format.sampleRateHz === 24_000 && format.channels === 1)
  )) ?? null;
}

export function decodeTalkSession(value: unknown): TalkSession | null {
  if (!isRecord(value)) return null;
  const sessionId = string(value.sessionId);
  if (!sessionId || value.mode !== 'realtime' || value.transport !== 'gateway-relay' || value.brain !== 'agent-consult') {
    return null;
  }
  const provider = value.provider === undefined ? null : string(value.provider);
  return provider === null && value.provider !== undefined ? null : { sessionId, provider };
}

export function decodeTalkEvent(value: unknown): TalkEvent | null {
  if (!isRecord(value)) return null;
  const id = string(value.id);
  const type = string(value.type);
  const sessionId = string(value.sessionId);
  const mode = enumValue(value.mode, MODES);
  const transport = enumValue(value.transport, TRANSPORTS);
  const brain = enumValue(value.brain, BRAINS);
  if (!id || !type || !sessionId || !mode || !transport || !brain || typeof value.seq !== 'number'
    || !Number.isInteger(value.seq) || value.seq < 0
    || !Object.prototype.hasOwnProperty.call(value, 'payload')) return null;
  const turnId = value.turnId === undefined ? null : string(value.turnId);
  if (value.turnId !== undefined && !turnId) return null;
  return { id, type, sessionId, turnId, seq: value.seq, mode, transport, brain, payload: value.payload };
}
