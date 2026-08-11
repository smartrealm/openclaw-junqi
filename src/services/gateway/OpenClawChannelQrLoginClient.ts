export const OPENCLAW_CHANNEL_QR_LOGIN_START_METHOD = 'web.login.start' as const;
export const OPENCLAW_CHANNEL_QR_LOGIN_WAIT_METHOD = 'web.login.wait' as const;

export interface OpenClawChannelQrLoginClientDependencies {
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
}
