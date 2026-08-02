export type ChannelRuntimeAction = 'channels.start' | 'channels.stop' | 'channels.logout';

export interface ChannelRuntimeActionTarget {
  channelId: string;
  accountId?: string;
}

export type PrivilegedGatewayRequest = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export function channelRuntimeActionParams(target: ChannelRuntimeActionTarget): Record<string, unknown> {
  const channel = target.channelId.trim();
  if (!channel) throw new Error('Channel ID is required.');
  const accountId = target.accountId?.trim();
  return {
    channel,
    ...(accountId && accountId !== 'default' ? { accountId } : {}),
  };
}

/** Channel lifecycle controls are OpenClaw control-plane operations. */
export function runChannelRuntimeAction(
  requestPrivileged: PrivilegedGatewayRequest,
  action: ChannelRuntimeAction,
  target: ChannelRuntimeActionTarget,
): Promise<unknown> {
  return requestPrivileged(action, channelRuntimeActionParams(target));
}
