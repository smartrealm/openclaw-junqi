export type TalkMode = 'realtime' | 'stt-tts' | 'transcription';
export type TalkTransport = 'webrtc' | 'provider-websocket' | 'gateway-relay' | 'managed-room';
export type TalkBrain = 'agent-consult' | 'direct-tools' | 'none';
export type TalkAgentControlMode = 'status' | 'steer' | 'cancel' | 'followup';
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
  inputAudioFormat: TalkAudioFormat;
  outputAudioFormat: TalkAudioFormat;
}

export interface TalkRealtimeRelaySelection {
  provider: TalkProviderCatalogEntry;
  inputAudioFormat: TalkAudioFormat;
  outputAudioFormat: TalkAudioFormat;
}

export interface TalkEvent {
  id: string;
  type: TalkEventType;
  sessionId: string;
  turnId: string | null;
  captureId?: string;
  seq: number;
  mode: TalkMode;
  transport: TalkTransport;
  brain: TalkBrain;
  provider?: string;
  final?: boolean;
  callId?: string;
  itemId?: string;
  parentId?: string;
  payload: unknown;
}

export interface TalkToolCallPayload {
  name: string;
  args: unknown;
  forced: boolean;
}

export interface TalkAgentControlInput {
  text: string;
  mode?: TalkAgentControlMode;
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
const AGENT_CONTROL_MODES = ['status', 'steer', 'cancel', 'followup'] as const;
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
const TURN_SCOPED_EVENT_TYPES: readonly TalkEventType[] = [
  'turn.started',
  'turn.ended',
  'turn.cancelled',
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
];
const CAPTURE_SCOPED_EVENT_TYPES: readonly TalkEventType[] = [
  'capture.started',
  'capture.stopped',
  'capture.cancelled',
  'capture.once',
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

function supportedNativeInputFormat(format: TalkAudioFormat): boolean {
  return format.encoding === 'pcm16'
    && format.channels === 1
    && format.sampleRateHz >= 8_000
    && format.sampleRateHz <= 192_000;
}

function supportedNativeOutputFormat(format: TalkAudioFormat): boolean {
  return format.encoding === 'pcm16'
    && format.channels >= 1
    && format.channels <= 8
    && format.sampleRateHz >= 8_000
    && format.sampleRateHz <= 192_000;
}

export function selectRealtimeRelayConfiguration(catalog: TalkCatalog): TalkRealtimeRelaySelection | null {
  if (catalog.realtime.ready !== true) return null;
  const eligible = catalog.realtime.providers.filter((provider) => (
    provider.configured
    && provider.modes?.includes('realtime')
    && provider.transports?.includes('gateway-relay')
    && provider.brains?.includes('agent-consult')
    && provider.supportsBargeIn === true
    && provider.supportsToolCalls === true
    && provider.inputAudioFormats?.some(supportedNativeInputFormat)
    && provider.outputAudioFormats?.some(supportedNativeOutputFormat)
  ));
  const provider = eligible.find((entry) => entry.id === catalog.realtime.activeProvider)
    ?? eligible[0];
  if (!provider) return null;
  const inputAudioFormat = provider.inputAudioFormats?.find(supportedNativeInputFormat);
  const outputAudioFormat = provider.outputAudioFormats?.find(supportedNativeOutputFormat);
  return inputAudioFormat && outputAudioFormat
    ? { provider, inputAudioFormat, outputAudioFormat }
    : null;
}

export function decodeTalkSession(
  value: unknown,
  selection: TalkRealtimeRelaySelection,
): TalkSession | null {
  if (!isRecord(value)) return null;
  const sessionId = string(value.sessionId);
  if (!sessionId || value.mode !== 'realtime' || value.transport !== 'gateway-relay' || value.brain !== 'agent-consult') {
    return null;
  }
  const provider = value.provider === undefined ? null : string(value.provider);
  if (
    (provider === null && value.provider !== undefined)
    || (provider !== null && provider !== selection.provider.id)
    || !isRecord(value.audio)
  ) return null;

  const inputEncoding = enumValue(value.audio.inputEncoding, ['pcm16', 'g711_ulaw'] as const);
  const outputEncoding = enumValue(value.audio.outputEncoding, ['pcm16', 'g711_ulaw'] as const);
  const inputSampleRateHz = value.audio.inputSampleRateHz;
  const outputSampleRateHz = value.audio.outputSampleRateHz;
  if (
    !inputEncoding
    || !outputEncoding
    || typeof inputSampleRateHz !== 'number'
    || !Number.isInteger(inputSampleRateHz)
    || typeof outputSampleRateHz !== 'number'
    || !Number.isInteger(outputSampleRateHz)
  ) return null;

  const inputAudioFormat = selection.provider.inputAudioFormats?.find((format) => (
    supportedNativeInputFormat(format)
    && format.encoding === inputEncoding
    && format.sampleRateHz === inputSampleRateHz
  ));
  const outputAudioFormat = selection.provider.outputAudioFormats?.find((format) => (
    supportedNativeOutputFormat(format)
    && format.encoding === outputEncoding
    && format.sampleRateHz === outputSampleRateHz
  ));
  if (!inputAudioFormat || !outputAudioFormat) return null;

  return {
    sessionId,
    provider,
    inputAudioFormat: { ...inputAudioFormat },
    outputAudioFormat: { ...outputAudioFormat },
  };
}

export function decodeTalkEvent(value: unknown): TalkEvent | null {
  if (!isRecord(value)) return null;
  const id = string(value.id);
  const type = enumValue(value.type, EVENT_TYPES);
  const sessionId = string(value.sessionId);
  const timestamp = string(value.timestamp);
  const mode = enumValue(value.mode, MODES);
  const transport = enumValue(value.transport, TRANSPORTS);
  const brain = enumValue(value.brain, BRAINS);
  if (!id || !type || !sessionId || !mode || !transport || !brain || typeof value.seq !== 'number'
    || !Number.isInteger(value.seq) || value.seq < 1 || !timestamp
    || !Object.prototype.hasOwnProperty.call(value, 'payload')) return null;
  const turnId = value.turnId === undefined ? null : string(value.turnId);
  const captureId = value.captureId === undefined ? null : string(value.captureId);
  const provider = value.provider === undefined ? undefined : string(value.provider);
  const final = optionalBoolean(value.final);
  const callId = value.callId === undefined ? undefined : string(value.callId);
  const itemId = value.itemId === undefined ? undefined : string(value.itemId);
  const parentId = value.parentId === undefined ? undefined : string(value.parentId);
  if ((value.turnId !== undefined && !turnId)
    || (value.captureId !== undefined && !captureId)
    || provider === null
    || final === null
    || callId === null
    || itemId === null
    || parentId === null
    || (TURN_SCOPED_EVENT_TYPES.includes(type) && !turnId)
    || (CAPTURE_SCOPED_EVENT_TYPES.includes(type) && !captureId)) return null;
  return {
    id,
    type,
    sessionId,
    turnId,
    ...(captureId ? { captureId } : {}),
    seq: value.seq,
    mode,
    transport,
    brain,
    ...(provider === undefined ? {} : { provider }),
    ...(final === undefined ? {} : { final }),
    ...(callId === undefined ? {} : { callId }),
    ...(itemId === undefined ? {} : { itemId }),
    ...(parentId === undefined ? {} : { parentId }),
    payload: value.payload,
  };
}

export function decodeTalkTextPayload(value: unknown): { text: string } | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  return { text: value.text };
}

export function decodeTalkToolCallPayload(value: unknown): TalkToolCallPayload | null {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'args')) return null;
  const name = string(value.name);
  const forced = optionalBoolean(value.forced);
  if (!name || forced === null) return null;
  return {
    name,
    args: value.args,
    forced: forced ?? false,
  };
}

export function decodeTalkAgentControlInput(value: unknown): TalkAgentControlInput | null {
  let source: unknown = value;
  if (typeof source === 'string') {
    const normalized = source.trim();
    if (!normalized) return null;
    try {
      source = JSON.parse(normalized) as unknown;
    } catch {
      source = { text: normalized };
    }
  }
  if (!isRecord(source)) return null;
  const text = [source.text, source.message, source.request, source.query]
    .find((candidate) => typeof candidate === 'string' && candidate.trim());
  if (typeof text !== 'string') return null;
  const mode = enumValue(source.mode, AGENT_CONTROL_MODES);
  return {
    text: text.trim(),
    ...(mode ? { mode } : {}),
  };
}
