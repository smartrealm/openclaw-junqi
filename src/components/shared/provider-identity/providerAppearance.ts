import { normalizeProviderIdentity } from './providerIdentity';

export const PROVIDER_APPEARANCE_STORAGE_KEY = 'junqi:provider-appearance:v1';
export const PROVIDER_APPEARANCE_CHANGED_EVENT = 'junqi:provider-appearance-changed';

export interface ProviderAppearance {
  icon?: string;
}

type ProviderAppearanceMap = Record<string, ProviderAppearance>;

export function normalizeCustomProviderIcon(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.trim()).slice(0, 8).join('');
}

export function parseProviderAppearances(raw: string | null): ProviderAppearanceMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: ProviderAppearanceMap = {};
    for (const [providerId, appearance] of Object.entries(parsed)) {
      if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) continue;
      const normalizedId = normalizeProviderIdentity(providerId);
      const icon = normalizeCustomProviderIcon((appearance as ProviderAppearance).icon);
      if (normalizedId && icon) result[normalizedId] = { icon };
    }
    return result;
  } catch {
    return {};
  }
}

function readProviderAppearances(): ProviderAppearanceMap {
  try {
    return parseProviderAppearances(window.localStorage.getItem(PROVIDER_APPEARANCE_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function getCustomProviderIcon(providerId: string): string {
  return readProviderAppearances()[normalizeProviderIdentity(providerId)]?.icon ?? '';
}

export function setCustomProviderAppearance(providerId: string, appearance: ProviderAppearance): void {
  const normalizedId = normalizeProviderIdentity(providerId);
  if (!normalizedId) return;
  const appearances = readProviderAppearances();
  const icon = normalizeCustomProviderIcon(appearance.icon);
  if (icon) appearances[normalizedId] = { icon };
  else delete appearances[normalizedId];
  try {
    window.localStorage.setItem(PROVIDER_APPEARANCE_STORAGE_KEY, JSON.stringify(appearances));
    window.dispatchEvent(new CustomEvent(PROVIDER_APPEARANCE_CHANGED_EVENT, {
      detail: { providerId: normalizedId },
    }));
  } catch {
    // Presentation metadata is optional; provider operation must remain usable.
  }
}

export function subscribeProviderAppearance(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROVIDER_APPEARANCE_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(PROVIDER_APPEARANCE_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PROVIDER_APPEARANCE_CHANGED_EVENT, listener);
  };
}
