import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_MODEL_PROBE_METHOD = 'models.probe' as const;

const PROBE_STATUSES = [
  'ok',
  'auth',
  'rate_limit',
  'billing',
  'timeout',
  'format',
  'unknown',
  'no_model',
] as const;

export type OpenClawModelProbeStatus = typeof PROBE_STATUSES[number];

export interface OpenClawModelProbeResult {
  readonly provider: string;
  readonly status: OpenClawModelProbeStatus;
  readonly latencyMs?: number;
  readonly targetCount: number;
}

export interface OpenClawModelProbeClientDependencies {
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

export class OpenClawModelProbeUnavailableError extends Error {
  readonly code = 'OPENCLAW_MODEL_PROBE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawModelProbeUnavailableError';
  }
}

export class OpenClawModelProbeResponseError extends Error {
  readonly code = 'OPENCLAW_MODEL_PROBE_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid models.probe response');
    this.name = 'OpenClawModelProbeResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function probeStatus(value: unknown): OpenClawModelProbeStatus | null {
  return typeof value === 'string' && PROBE_STATUSES.includes(value as OpenClawModelProbeStatus)
    ? value as OpenClawModelProbeStatus
    : null;
}

function latency(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OpenClawModelProbeResponseError();
  }
  return value;
}

export function parseOpenClawModelProbe(value: unknown): OpenClawModelProbeResult {
  const source = record(value);
  const provider = nonEmptyText(source?.provider);
  const status = probeStatus(source?.status);
  if (!source || !provider || !status || !Array.isArray(source.results)) {
    throw new OpenClawModelProbeResponseError();
  }
  for (const result of source.results) {
    const row = record(result);
    if (!row || !nonEmptyText(row.label) || !probeStatus(row.status)) {
      throw new OpenClawModelProbeResponseError();
    }
    latency(row.latencyMs);
  }
  const latencyMs = latency(source.latencyMs);
  return {
    provider,
    status,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    targetCount: source.results.length,
  };
}

export class OpenClawModelProbeClient {
  constructor(private readonly dependencies: OpenClawModelProbeClientDependencies) {}

  async probeProvider(provider: string): Promise<OpenClawModelProbeResult> {
    const normalizedProvider = provider.trim();
    if (!normalizedProvider) throw new OpenClawModelProbeResponseError();
    try {
      const response = await this.dependencies.requestPrivileged(
        OPENCLAW_MODEL_PROBE_METHOD,
        { provider: normalizedProvider },
      );
      const result = parseOpenClawModelProbe(response);
      if (result.provider !== normalizedProvider) throw new OpenClawModelProbeResponseError();
      return result;
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_MODEL_PROBE_METHOD)) {
        throw new OpenClawModelProbeUnavailableError(
          'The connected OpenClaw Gateway does not support models.probe',
        );
      }
      throw error;
    }
  }
}
