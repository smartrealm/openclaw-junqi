export const OPENCLAW_CHANNEL_QR_LOGIN_START_METHOD = 'web.login.start' as const;
export const OPENCLAW_CHANNEL_QR_LOGIN_WAIT_METHOD = 'web.login.wait' as const;
export const OPENCLAW_CHANNEL_STATUS_METHOD = 'channels.status' as const;

export interface OpenClawChannelQrLoginClientDependencies {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

export class OpenClawChannelQrLoginClient {
  constructor(private readonly dependencies: OpenClawChannelQrLoginClientDependencies) {}

  start(params: Record<string, unknown>): Promise<unknown> {
    return this.dependencies.requestPrivileged(OPENCLAW_CHANNEL_QR_LOGIN_START_METHOD, params);
  }

  wait(params: Record<string, unknown>): Promise<unknown> {
    return this.dependencies.requestPrivileged(OPENCLAW_CHANNEL_QR_LOGIN_WAIT_METHOD, params);
  }

  status(params: Record<string, unknown>): Promise<unknown> {
    return this.dependencies.request(OPENCLAW_CHANNEL_STATUS_METHOD, params);
  }
}
