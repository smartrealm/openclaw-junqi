import type { GatewayRuntimeConfig } from '@/types/openclawConfig';
import type { ChannelAccountBinding, ChannelGroupView } from '@/services/channelConfig';

export type ChannelGroupWithName = ChannelGroupView & { name: string };

export interface EditingAccountState {
  mode: 'new' | 'edit';
  group: ChannelGroupWithName;
  account?: ChannelAccountBinding;
  draftConfig?: GatewayRuntimeConfig;
}

export function nextChannelAccountId(channelId: string, groups: ChannelGroupWithName[]): string {
  const used = new Set(
    groups.find((group) => group.id === channelId)?.accounts.map((account) => account.id) ?? [],
  );
  let index = 1;
  let id = `${channelId}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${channelId}-${index}`;
  }
  return id;
}
