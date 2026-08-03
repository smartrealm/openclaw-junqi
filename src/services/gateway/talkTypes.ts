export type TalkMode = 'realtime' | 'stt-tts' | 'transcription';
export type TalkTransport = 'webrtc' | 'provider-websocket' | 'gateway-relay' | 'managed-room';
export type TalkBrain = 'agent-consult' | 'direct-tools' | 'none';
export type TalkEventType =
  | 'session.started'
  | 'session.ready'
  | 'session.closed'
  | 'session.error'
  | 'session.replaced'
  | 'turn.started'
  | 'turn.ended'
  | 'turn.cancelled'
  | 'capture.started'
  | 'capture.stopped'
  | 'capture.cancelled'
  | 'capture.once'
  | 'input.audio.delta'
  | 'input.audio.committed'
  | 'transcript.delta'
  | 'transcript.done'
  | 'output.text.delta'
  | 'output.text.done'
  | 'output.audio.started'
  | 'output.audio.delta'
  | 'output.audio.done'
  | 'tool.call'
  | 'tool.progress'
  | 'tool.result'
  | 'tool.error'
  | 'usage.metrics'
  | 'latency.metrics'
  | 'health.changed';

export interface TalkAudioFormat {
  encoding: 'pcm16' | 'g711_ulaw';
  sampleRateHz: number;
  channels: number;
}

export interface TalkProviderCatalogEntry {
  id: string;
  configured: boolean;
  modes: TalkMode[];
  transports: TalkTransport[];
  brains: TalkBrain[];
  inputAudioFormats: TalkAudioFormat[];
  supportsBargeIn: boolean;
}

export interface TalkCatalog {
  ready: boolean;
  providers: TalkProviderCatalogEntry[];
}

export interface TalkSession {
  sessionId: string;
  provider: string | null;
}

export interface TalkEvent {
  id: string;
  type: TalkEventType;
  sessionId: string;
  turnId: string | null;
  seq: number;
  mode: TalkMode;
  transport: TalkTransport;
  brain: TalkBrain;
  payload: unknown;
}

export interface TalkSessionReplacedPayload {
  handoffId: string;
  roomId: string;
  previousClientId: string;
  nextClientId: string;
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
const EVENT_TYPES: readonly TalkEventType[] = [
  'session.started',
  'session.ready',
  'session.closed',
  'session.error',
  'session.replaced',
  'turn.started',
  'turn.ended',
  'turn.cancelled',
  'capture.started',
  'capture.stopped',
  'capture.cancelled',
  'capture.once',
  'input.audio.delta',
  'input.audio.committed',
  'transcript.delta',
  'transcript.done',
  'output.text.delta',
  'output.text.done',
  'output.audio.started',
  'output.audio.delta',
  'output.audio.done',
  'tool.call',
  'tool.progress',
  'tool.result',
  'tool.error',
  'usage.metrics',
  'latency.metrics',
  'health.changed',
];

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

function audioFormats(value: unknown): TalkAudioFormat[] | null {
  if (!Array.isArray(value)) return null;
  const decoded: TalkAudioFormat[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const encoding = enumValue(item.encoding, ['pcm16', 'g711_ulaw'] as const);
    const sampleRateHz = item.sampleRateHz;
    const channels = item.channels;
    if (!encoding || typeof sampleRateHz !== 'number' || !Number.isInteger(sampleRateHz)
      || sampleRateHz < 8_000 || sampleRateHz > 96_000 || typeof channels !== 'number'
      || !Number.isInteger(channels) || channels < 1 || channels > 2) return null;
    decoded.push({ encoding, sampleRateHz, channels });
  }
  return decoded;
}

export function decodeTalkCatalog(value: unknown): TalkCatalog | null {
  if (!isRecord(value) || !isRecord(value.speech) || value.speech.ready !== true || !Array.isArray(value.speech.providers)) {
    return null;
  }
  const providers: TalkProviderCatalogEntry[] = [];
  for (const rawProvider of value.speech.providers) {
    if (!isRecord(rawProvider)) return null;
    const id = string(rawProvider.id);
    const modes = enumArray(rawProvider.modes, MODES);
    const transports = enumArray(rawProvider.transports, TRANSPORTS);
    const brains = enumArray(rawProvider.brains, BRAINS);
    const inputAudioFormats = audioFormats(rawProvider.inputAudioFormats);
    if (!id || typeof rawProvider.configured !== 'boolean' || !modes || !transports || !brains || !inputAudioFormats
      || typeof rawProvider.supportsBargeIn !== 'boolean') return null;
    providers.push({ id, configured: rawProvider.configured, modes, transports, brains, inputAudioFormats, supportsBargeIn: rawProvider.supportsBargeIn });
  }
  return { ready: true, providers };
}

export function selectRealtimeRelayProvider(catalog: TalkCatalog): TalkProviderCatalogEntry | null {
  return catalog.providers.find((provider) => (
    provider.configured
    && provider.modes.includes('realtime')
    && provider.transports.includes('gateway-relay')
    && provider.brains.includes('agent-consult')
    && provider.supportsBargeIn
    && provider.inputAudioFormats.some((format) => format.encoding === 'pcm16')
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
  const type = enumValue(value.type, EVENT_TYPES);
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

export function decodeTalkSessionReplacedPayload(value: unknown): TalkSessionReplacedPayload | null {
  if (!isRecord(value)) return null;
  const handoffId = string(value.handoffId);
  const roomId = string(value.roomId);
  const previousClientId = string(value.previousClientId);
  const nextClientId = string(value.nextClientId);
  if (!handoffId || !roomId || !previousClientId || !nextClientId) return null;
  return { handoffId, roomId, previousClientId, nextClientId };
}
