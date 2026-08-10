export interface ChannelCenterLoadingState {
  runtimeLoaded: boolean;
  loadingConfig: boolean;
  hasConfig: boolean;
}

export function shouldShowChannelCenterSkeleton({
  runtimeLoaded,
  loadingConfig,
  hasConfig,
}: ChannelCenterLoadingState): boolean {
  return !runtimeLoaded || (loadingConfig && !hasConfig);
}

export function getChannelAttentionCount(accountCount: number, readyCount: number): number {
  return Math.max(0, accountCount - readyCount);
}
