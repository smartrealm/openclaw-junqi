import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_DIAGNOSTIC_STABILITY_METHOD = 'diagnostics.stability' as const;

export interface OpenClawDiagnosticStabilityEvent {
  readonly seq: number;
  readonly ts: number;
  readonly type: string;
}

export interface OpenClawDiagnosticStabilitySnapshot {
  readonly generatedAt: string;
  readonly capacity: number;
  readonly count: number;
  readonly dropped: number;
  readonly firstSeq?: number;
  readonly lastSeq?: number;
  readonly events: readonly OpenClawDiagnosticStabilityEvent[];
  readonly byType: Readonly<Record<string, number>>;
}

export interface OpenClawDiagnosticStabilityClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawDiagnosticStabilityUnavailableError extends Error {
  readonly code = 'OPENCLAW_DIAGNOSTIC_STABILITY_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawDiagnosticStabilityUnavailableError';
  }
}

export class OpenClawDiagnosticStabilityResponseError extends Error {
  readonly code = 'OPENCLAW_DIAGNOSTIC_STABILITY_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid diagnostics.stability response');
    this.name = 'OpenClawDiagnosticStabilityResponseError';
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

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalNonNegativeInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return nonNegativeInteger(value);
}

function event(value: unknown): OpenClawDiagnosticStabilityEvent {
  const source = record(value);
  const seq = nonNegativeInteger(source?.seq);
  const ts = nonNegativeInteger(source?.ts);
  const type = text(source?.type);
  if (!source || seq === null || ts === null || !type) {
    throw new OpenClawDiagnosticStabilityResponseError();
  }
  return { seq, ts, type };
}

function summaryByType(value: unknown): Readonly<Record<string, number>> {
  const source = record(value);
  if (!source) throw new OpenClawDiagnosticStabilityResponseError();
  const entries = Object.entries(source);
  return Object.fromEntries(entries.map(([type, count]) => {
    const safeType = text(type);
    const safeCount = nonNegativeInteger(count);
    if (!safeType || safeCount === null) throw new OpenClawDiagnosticStabilityResponseError();
    return [safeType, safeCount];
  }));
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawDiagnosticStability(value: unknown): OpenClawDiagnosticStabilitySnapshot {
  const source = record(value);
  const generatedAt = text(source?.generatedAt);
  const capacity = nonNegativeInteger(source?.capacity);
  const count = nonNegativeInteger(source?.count);
  const dropped = nonNegativeInteger(source?.dropped);
  const firstSeq = optionalNonNegativeInteger(source?.firstSeq);
  const lastSeq = optionalNonNegativeInteger(source?.lastSeq);
  const summary = record(source?.summary);

  if (
    !source
    || !generatedAt
    || capacity === null
    || count === null
    || dropped === null
    || firstSeq === null
    || lastSeq === null
    || !Array.isArray(source.events)
    || !summary
  ) {
    throw new OpenClawDiagnosticStabilityResponseError();
  }

  return {
    generatedAt,
    capacity,
    count,
    dropped,
    ...(firstSeq === undefined ? {} : { firstSeq }),
    ...(lastSeq === undefined ? {} : { lastSeq }),
    events: source.events.map(event),
    byType: summaryByType(summary.byType),
  };
}

export class OpenClawDiagnosticStabilityClient {
  constructor(private readonly dependencies: OpenClawDiagnosticStabilityClientDependencies) {}

  async get(): Promise<OpenClawDiagnosticStabilitySnapshot> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawDiagnosticStabilityUnavailableError(
        'No attested Gateway connection is available for stability diagnostics',
      );
    }
    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_DIAGNOSTIC_STABILITY_METHOD,
        {},
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawDiagnosticStabilityUnavailableError(
          'Gateway connection changed while reading stability diagnostics',
        );
      }
      return parseOpenClawDiagnosticStability(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawDiagnosticStabilityUnavailableError(
          'The connected OpenClaw Gateway does not support diagnostics.stability',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawDiagnosticStabilityUnavailableError(
          'No attested Gateway connection is available for stability diagnostics',
        );
      }
      throw error;
    }
  }
}
