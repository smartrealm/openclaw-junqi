import { assessChannelAccountReadiness, buildChannelGroups } from '@/services/channelConfig';
import type { ChannelsRuntimeSnapshot } from '@/services/openclawChannelRuntime';

export function hasReadyChannelAccount(config: Parameters<typeof buildChannelGroups>[0], snapshot: ChannelsRuntimeSnapshot | null): boolean {
  if (!snapshot?.gatewayReachable) return false;
  return buildChannelGroups(config).some((group) => group.accounts.some((account) => {
    const runtime = snapshot.channelAccounts?.[group.id]?.find((row) => row.accountId === account.id)
      ?? (account.id === 'default' ? snapshot.channelAccounts?.[group.id]?.[0] : undefined);
    return assessChannelAccountReadiness(group.id, account, runtime).state === 'ready';
  }));
}
