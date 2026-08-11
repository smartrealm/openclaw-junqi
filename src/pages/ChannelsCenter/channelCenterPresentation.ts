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
