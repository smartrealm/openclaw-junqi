import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_MODEL_AUTH_LOGOUT_METHOD = 'models.authLogout' as const;

export interface OpenClawModelAuthLogoutResult {
  readonly provider: string;
  readonly removedProfileCount: number;
  readonly abortedRunCount: number;
}

export interface OpenClawModelAuthLogoutClientDependencies {
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

export class OpenClawModelAuthLogoutUnavailableError extends Error {
  readonly code = 'OPENCLAW_MODEL_AUTH_LOGOUT_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawModelAuthLogoutUnavailableError';
  }
}

export class OpenClawModelAuthLogoutResponseError extends Error {
  readonly code = 'OPENCLAW_MODEL_AUTH_LOGOUT_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid models.authLogout response');
    this.name = 'OpenClawModelAuthLogoutResponseError';
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

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  return strings.length === value.length ? strings.map((item) => item.trim()) : null;
}

export function parseOpenClawModelAuthLogout(value: unknown): OpenClawModelAuthLogoutResult {
  const source = record(value);
  const provider = nonEmptyText(source?.provider);
  const removedProfiles = stringArray(source?.removedProfiles);
  const abortedRunIds = stringArray(source?.abortedRunIds);
  if (!source || !provider || !removedProfiles || !abortedRunIds) {
    throw new OpenClawModelAuthLogoutResponseError();
  }
  return {
    provider,
    removedProfileCount: removedProfiles.length,
    abortedRunCount: abortedRunIds.length,
  };
}

export class OpenClawModelAuthLogoutClient {
  constructor(private readonly dependencies: OpenClawModelAuthLogoutClientDependencies) {}

  async logoutProvider(provider: string): Promise<OpenClawModelAuthLogoutResult> {
    const normalizedProvider = provider.trim();
    if (!normalizedProvider) throw new OpenClawModelAuthLogoutResponseError();
    try {
      const response = await this.dependencies.requestPrivileged(
        OPENCLAW_MODEL_AUTH_LOGOUT_METHOD,
        { provider: normalizedProvider },
      );
      const result = parseOpenClawModelAuthLogout(response);
      if (result.provider !== normalizedProvider) throw new OpenClawModelAuthLogoutResponseError();
      return result;
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_MODEL_AUTH_LOGOUT_METHOD)) {
        throw new OpenClawModelAuthLogoutUnavailableError(
          'The connected OpenClaw Gateway does not support models.authLogout',
        );
      }
      throw error;
    }
  }
}
