import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export interface OpenClawCronStatus {
  readonly enabled: boolean;
  readonly storage: 'sqlite';
  readonly jobs: number;
  readonly nextWakeAtMs: number | null;
}

export type OpenClawCronStatusRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

const CRON_STATUS_METHOD = 'cron.status';

export class OpenClawCronStatusUnsupportedError extends Error {
  readonly code = 'OPENCLAW_CRON_STATUS_UNSUPPORTED';

  constructor() {
    super(`The connected OpenClaw Gateway does not support ${CRON_STATUS_METHOD}`);
    this.name = 'OpenClawCronStatusUnsupportedError';
  }
}

export class OpenClawCronStatusResponseError extends Error {
  readonly code = 'OPENCLAW_CRON_STATUS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid cron scheduler status response');
    this.name = 'OpenClawCronStatusResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OpenClawCronStatusResponseError();
  }
  return value;
}

export function parseOpenClawCronStatus(value: unknown): OpenClawCronStatus {
  const source = record(value);
  if (!source || typeof source.enabled !== 'boolean' || source.storage !== 'sqlite') {
    throw new OpenClawCronStatusResponseError();
  }
  const nextWakeAtMs = source.nextWakeAtMs;
  if (nextWakeAtMs !== null && !Number.isSafeInteger(nextWakeAtMs)) {
    throw new OpenClawCronStatusResponseError();
  }
  return {
    enabled: source.enabled,
    storage: 'sqlite',
    jobs: nonNegativeInteger(source.jobs),
    nextWakeAtMs: nextWakeAtMs === null ? null : nonNegativeInteger(nextWakeAtMs),
  };
}

export class OpenClawCronStatusClient {
  constructor(
    private readonly request: OpenClawCronStatusRequester,
  ) {}

  async get(): Promise<OpenClawCronStatus> {
    try {
      return parseOpenClawCronStatus(await this.request<unknown>(CRON_STATUS_METHOD, {}));
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, CRON_STATUS_METHOD)) {
        throw new OpenClawCronStatusUnsupportedError();
      }
      throw error;
    }
  }
}
