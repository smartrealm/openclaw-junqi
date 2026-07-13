export const CONFIG_TABS = ['providers', 'agents', 'channels', 'tools', 'advanced', 'secrets'] as const;

export type ConfigTab = typeof CONFIG_TABS[number];

export type ConfigNavigationIntent = {
  tab?: ConfigTab;
  addProvider: boolean;
  consumedParams?: URLSearchParams;
};

export function readConfigNavigationIntent(params: URLSearchParams): ConfigNavigationIntent {
  const rawTab = params.get('tab');
  const tab = CONFIG_TABS.find((candidate) => candidate === rawTab);
  const addProvider = tab === 'providers' && params.get('action') === 'add';
  if (!addProvider) return { tab, addProvider: false };

  const consumedParams = new URLSearchParams(params);
  consumedParams.delete('action');
  return { tab, addProvider: true, consumedParams };
}
