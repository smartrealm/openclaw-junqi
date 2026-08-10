import { GatewayDisconnectedError } from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_SETUP_VERIFY_METHOD = 'openclaw.setup.verify' as const;

export type OpenClawSetupVerification =
  | { readonly ok: true; readonly modelRef: string; readonly latencyMs: number }
  | { readonly ok: false; readonly status: OpenClawSetupVerificationFailureStatus; readonly error: string };

const FAILURE_STATUSES = [
  'auth',
  'rate_limit',
  'billing',
  'timeout',
  'format',
  'unavailable',
  'unknown',
] as const;

export type OpenClawSetupVerificationFailureStatus = typeof FAILURE_STATUSES[number];

export class OpenClawSetupVerificationUnavailableError extends Error {
  readonly code = 'OPENCLAW_SETUP_VERIFY_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawSetupVerificationUnavailableError';
  }
}

export class OpenClawSetupVerificationResponseError extends Error {
  readonly code = 'OPENCLAW_SETUP_VERIFY_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid openclaw.setup.verify response');
    this.name = 'OpenClawSetupVerificationResponseError';
  }
}

export interface OpenClawSetupVerificationClientDependencies {
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function failureStatus(value: unknown): OpenClawSetupVerificationFailureStatus | null {
  return typeof value === 'string' && FAILURE_STATUSES.includes(value as OpenClawSetupVerificationFailureStatus)
    ? value as OpenClawSetupVerificationFailureStatus
    : null;
}

export function parseOpenClawSetupVerification(value: unknown): OpenClawSetupVerification {
  const source = record(value);
  if (!source || typeof source.ok !== 'boolean') throw new OpenClawSetupVerificationResponseError();
  if (source.ok) {
    const modelRef = nonEmptyText(source.modelRef);
    const latencyMs = source.latencyMs;
    if (!modelRef || typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) {
      throw new OpenClawSetupVerificationResponseError();
    }
    return { ok: true, modelRef, latencyMs };
  }

  const status = failureStatus(source.status);
  const error = nonEmptyText(source.error);
  if (!status || !error) throw new OpenClawSetupVerificationResponseError();
  return { ok: false, status, error };
}

export class OpenClawSetupVerificationClient {
  constructor(private readonly dependencies: OpenClawSetupVerificationClientDependencies) {}

  async verify(): Promise<OpenClawSetupVerification> {
    try {
      return parseOpenClawSetupVerification(await this.dependencies.requestPrivileged(
        OPENCLAW_SETUP_VERIFY_METHOD,
        {},
      ));
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_SETUP_VERIFY_METHOD)) {
        throw new OpenClawSetupVerificationUnavailableError(
          'The connected OpenClaw Gateway does not support openclaw.setup.verify',
        );
      }
      if (error instanceof GatewayDisconnectedError) {
        throw new OpenClawSetupVerificationUnavailableError(
          'No authenticated OpenClaw Gateway connection is available for setup verification',
        );
      }
      throw error;
    }
  }
}
