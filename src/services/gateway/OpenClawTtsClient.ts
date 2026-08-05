import type { GatewayRequestOptions } from './Connection';

export interface OpenClawTtsClip {
  readonly audioBase64: string;
  readonly provider: string;
  readonly outputFormat: string | null;
  readonly mimeType: string | null;
  readonly fileExtension: string | null;
}

export interface OpenClawTtsSpeakInput {
  readonly text: string;
  readonly signal?: AbortSignal;
}

export type OpenClawTtsRequester = (
  method: string,
  params: Record<string, unknown>,
  options?: GatewayRequestOptions,
) => Promise<unknown>;

export class OpenClawTtsResponseError extends Error {
  readonly code = 'OPENCLAW_TTS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid TTS speech response');
    this.name = 'OpenClawTtsResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function parseOpenClawTtsClip(value: unknown): OpenClawTtsClip {
  const response = record(value);
  const audioBase64 = nonEmptyText(response?.audioBase64);
  const provider = nonEmptyText(response?.provider);
  const outputFormat = optionalText(response?.outputFormat);
  const mimeType = optionalText(response?.mimeType);
  const fileExtension = optionalText(response?.fileExtension);
  if (!response || !audioBase64 || !provider
    || outputFormat === null || mimeType === null || fileExtension === null) {
    throw new OpenClawTtsResponseError();
  }
  return {
    audioBase64,
    provider,
    outputFormat: outputFormat ?? null,
    mimeType: mimeType ?? null,
    fileExtension: fileExtension ?? null,
  };
}

/** Strict client for OpenClaw's remote-client-safe inline TTS output. */
export class OpenClawTtsClient {
  constructor(private readonly request: OpenClawTtsRequester) {}

  async speak(input: OpenClawTtsSpeakInput): Promise<OpenClawTtsClip> {
    const text = nonEmptyText(input.text);
    if (!text) throw new Error('OpenClaw tts.speak requires non-empty text');
    return parseOpenClawTtsClip(await this.request('tts.speak', { text }, {
      ...(input.signal ? { signal: input.signal } : {}),
    }));
  }
}
