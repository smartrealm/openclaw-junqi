import { isFeatureEnabled, type EditionFeatureKey } from '@/config/edition';

export type FeatureLinkedItem = {
  feature?: EditionFeatureKey;
};

/** Keep navigation from advertising routes disabled by the current edition. */
export function filterEnabledNavigationItems<T extends FeatureLinkedItem>(items: readonly T[]): T[] {
  return items.filter((item) => !item.feature || isFeatureEnabled(item.feature));
}
