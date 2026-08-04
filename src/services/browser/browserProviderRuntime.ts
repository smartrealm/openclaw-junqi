import { invoke } from '@tauri-apps/api/core';
import { parseBrowserProviderProbes, type BrowserProviderProbe } from './browserProviders';

export async function probeBrowserProviders(): Promise<BrowserProviderProbe[]> {
  return parseBrowserProviderProbes(await invoke<unknown>('probe_browser_providers'));
}

export async function openEgoLite(): Promise<void> {
  await invoke('open_ego_lite');
}
