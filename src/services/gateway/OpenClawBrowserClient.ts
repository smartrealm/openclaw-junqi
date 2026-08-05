import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_BROWSER_REQUEST_METHOD = 'browser.request' as const;

export type OpenClawBrowserHttpMethod = 'GET' | 'POST' | 'DELETE';

export interface OpenClawBrowserRequest {
  readonly method: OpenClawBrowserHttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

export interface OpenClawBrowserProfile {
  readonly name: string;
  readonly driver: string;
  readonly running: boolean;
  readonly tabCount: number;
  readonly isDefault: boolean;
  readonly isRemote: boolean;
  readonly color?: string;
}

export interface OpenClawBrowserStatus {
  readonly profile: string;
  readonly running: boolean;
  readonly cdpReady: boolean;
  readonly pageReady: boolean;
  readonly driver?: string;
  readonly detectedBrowser?: string;
  readonly detectError?: string;
}

export interface OpenClawBrowserTab {
  readonly targetId: string;
  readonly tabId?: string;
  readonly suggestedTargetId?: string;
  readonly title?: string;
  readonly url?: string;
  readonly label?: string;
}

export interface OpenClawBrowserClientDependencies {
  request: <T>(method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
}

export class OpenClawBrowserUnavailableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OpenClawBrowserUnavailableError';
    this.code = code;
  }
}

export class OpenClawBrowserResponseError extends Error {
  readonly code = 'OPENCLAW_BROWSER_RESPONSE_INVALID';

  constructor(message = 'The OpenClaw Gateway returned an invalid browser response') {
    super(message);
    this.name = 'OpenClawBrowserResponseError';
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

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  return text(value);
}

function query(profile?: string): Readonly<Record<string, string>> | undefined {
  const normalized = profile?.trim();
  return normalized ? { profile: normalized } : undefined;
}

function requireBrowserPath(path: string): string {
  if (!path.startsWith('/') || path.includes('://') || path.includes('..')) {
    throw new Error('OpenClaw browser path must be an absolute control route');
  }
  return path;
}

function requireHttpUrl(value: string): string {
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Browser URL must be an absolute HTTP or HTTPS URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Browser URL must use HTTP or HTTPS');
  }
  return parsed.toString();
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawBrowserStatus(value: unknown): OpenClawBrowserStatus {
  const source = record(value);
  const profile = text(source?.profile);
  const running = source?.running;
  const cdpReady = source?.cdpReady;
  const pageReady = source?.pageReady;
  const driver = optionalText(source?.driver);
  const detectedBrowser = optionalText(source?.detectedBrowser);
  const detectError = optionalText(source?.detectError);
  if (
    !source
    || !profile
    || typeof running !== 'boolean'
    || typeof cdpReady !== 'boolean'
    || typeof pageReady !== 'boolean'
    || driver === null
    || detectedBrowser === null
    || detectError === null
  ) {
    throw new OpenClawBrowserResponseError();
  }
  return {
    profile,
    running,
    cdpReady,
    pageReady,
    ...(driver ? { driver } : {}),
    ...(detectedBrowser ? { detectedBrowser } : {}),
    ...(detectError ? { detectError } : {}),
  };
}

function parseProfile(value: unknown): OpenClawBrowserProfile {
  const source = record(value);
  const name = text(source?.name);
  const driver = text(source?.driver);
  const tabCount = nonNegativeInteger(source?.tabCount);
  const color = optionalText(source?.color);
  if (
    !source
    || !name
    || !driver
    || typeof source.running !== 'boolean'
    || tabCount === null
    || typeof source.isDefault !== 'boolean'
    || typeof source.isRemote !== 'boolean'
    || color === null
  ) {
    throw new OpenClawBrowserResponseError('The OpenClaw Gateway returned an invalid browser profile');
  }
  return {
    name,
    driver,
    running: source.running,
    tabCount,
    isDefault: source.isDefault,
    isRemote: source.isRemote,
    ...(color ? { color } : {}),
  };
}

export function parseOpenClawBrowserProfiles(value: unknown): OpenClawBrowserProfile[] {
  const source = record(value);
  if (!source || !Array.isArray(source.profiles)) {
    throw new OpenClawBrowserResponseError('The OpenClaw Gateway returned invalid browser profiles');
  }
  return source.profiles.map(parseProfile);
}

function parseTab(value: unknown): OpenClawBrowserTab {
  const source = record(value);
  const targetId = text(source?.targetId);
  const tabId = optionalText(source?.tabId);
  const suggestedTargetId = optionalText(source?.suggestedTargetId);
  const title = optionalText(source?.title);
  const url = optionalText(source?.url);
  const label = optionalText(source?.label);
  if (!source || !targetId || tabId === null || suggestedTargetId === null || title === null || url === null || label === null) {
    throw new OpenClawBrowserResponseError('The OpenClaw Gateway returned an invalid browser tab');
  }
  return {
    targetId,
    ...(tabId ? { tabId } : {}),
    ...(suggestedTargetId ? { suggestedTargetId } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(label ? { label } : {}),
  };
}

export function parseOpenClawBrowserTabs(value: unknown): OpenClawBrowserTab[] {
  const source = record(value);
  if (!source || !Array.isArray(source.tabs)) {
    throw new OpenClawBrowserResponseError('The OpenClaw Gateway returned invalid browser tabs');
  }
  return source.tabs.map(parseTab);
}

/** Strict adapter for the official OpenClaw browser.request protocol. */
export class OpenClawBrowserClient {
  constructor(private readonly dependencies: OpenClawBrowserClientDependencies) {}

  async request<T = unknown>(input: OpenClawBrowserRequest): Promise<T> {
    const method = input.method;
    const path = requireBrowserPath(input.path);
    if (!['GET', 'POST', 'DELETE'].includes(method)) {
      throw new Error('Unsupported OpenClaw browser request method');
    }
    if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000)) {
      throw new Error('OpenClaw browser request timeout must be at least 1000 ms');
    }
    try {
      return await this.dependencies.request<T>(OPENCLAW_BROWSER_REQUEST_METHOD, {
        method,
        path,
        ...(input.query ? { query: input.query } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      }, input.timeoutMs);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawBrowserUnavailableError(
          'OPENCLAW_BROWSER_UNSUPPORTED',
          'The connected OpenClaw Gateway does not support browser.request',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawBrowserUnavailableError(
          'OPENCLAW_BROWSER_CONNECTION_UNAVAILABLE',
          'A verified Gateway connection is required for browser control',
        );
      }
      throw error;
    }
  }

  async status(profile?: string): Promise<OpenClawBrowserStatus> {
    return parseOpenClawBrowserStatus(await this.request({ method: 'GET', path: '/', query: query(profile) }));
  }

  async profiles(): Promise<OpenClawBrowserProfile[]> {
    return parseOpenClawBrowserProfiles(await this.request({ method: 'GET', path: '/profiles' }));
  }

  async tabs(profile?: string): Promise<OpenClawBrowserTab[]> {
    return parseOpenClawBrowserTabs(await this.request({ method: 'GET', path: '/tabs', query: query(profile) }));
  }

  async start(profile?: string): Promise<OpenClawBrowserStatus> {
    await this.request({ method: 'POST', path: '/start', query: query(profile), timeoutMs: 45_000 });
    return this.status(profile);
  }

  async stop(profile?: string): Promise<OpenClawBrowserStatus> {
    await this.request({ method: 'POST', path: '/stop', query: query(profile), timeoutMs: 45_000 });
    return this.status(profile);
  }

  async openTab(url: string, profile?: string, label?: string): Promise<OpenClawBrowserTab> {
    const response = await this.request({
      method: 'POST',
      path: '/tabs/open',
      query: query(profile),
      body: {
        url: requireHttpUrl(url),
        ...(label?.trim() ? { label: label.trim() } : {}),
      },
      timeoutMs: 45_000,
    });
    return parseTab(response);
  }

  async focusTab(targetId: string, profile?: string): Promise<void> {
    const target = targetId.trim();
    if (!target) throw new Error('Browser tab reference is required');
    await this.request({ method: 'POST', path: '/tabs/focus', query: query(profile), body: { targetId: target } });
  }

  async closeTab(targetId: string, profile?: string): Promise<void> {
    const target = targetId.trim();
    if (!target) throw new Error('Browser tab reference is required');
    await this.request({
      method: 'DELETE',
      path: `/tabs/${encodeURIComponent(target)}`,
      query: query(profile),
      timeoutMs: 45_000,
    });
  }

  async snapshot(profile?: string): Promise<unknown> {
    return this.request({
      method: 'GET',
      path: '/snapshot',
      query: { ...(query(profile) ?? {}), format: 'aria', interactive: true, compact: true, limit: 300 },
      timeoutMs: 30_000,
    });
  }
}
