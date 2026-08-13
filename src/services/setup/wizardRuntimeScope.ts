export function wizardRuntimeScopeKey(
  runtimeMode: 'native' | 'docker',
  gatewayWsUrl: string,
): string | null {
  try {
    const url = new URL(gatewayWsUrl.trim());
    if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.hostname || url.username || url.password) {
      return null;
    }
    return `${runtimeMode}:${url.toString()}`;
  } catch {
    return null;
  }
}
