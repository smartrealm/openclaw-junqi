/**
 * Theme — React integration. Single hook that owns:
 *   1. Resolving the store's ThemeSetting to a concrete AegisTheme.
 *   2. Applying it to <html> + the native title bar whenever it changes.
 *   3. Re-applying when the user is on `system` and the OS preference flips.
 *
 * Replaces ~30 lines of inline useEffects previously scattered in App.tsx.
 */
import { useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePrefersDark } from '@/hooks/usePrefersDark';
import { applyTheme } from './apply';
import { resolveTheme } from './resolver';
import type { AegisTheme } from './types';

/**
 * Mount-once hook for the root component. Returns the resolved theme
 * for components that need to render different content per theme
 * (charts, icons, splash images, etc.).
 *
 * The OS preference is sourced from `usePrefersDark`, which subscribes
 * to the prefers-color-scheme media query and triggers a re-render on
 * change. This makes the `system` setting genuinely live — flipping
 * macOS appearance updates the app without a restart or focus change.
 */
export function useTheme(): AegisTheme {
  const setting = useSettingsStore((s) => s.theme);
  const prefersDark = usePrefersDark();

  // `prefersDark` is a reactive value, so when the OS flips and the
  // user is on `system`, useMemo recomputes → useEffect re-applies.
  // For non-`system` settings, prefersDark is ignored by resolveTheme
  // and the memoized result is stable.
  const resolved = useMemo<AegisTheme>(
    () => resolveTheme(setting, prefersDark ? 'aegis-dark' : 'aegis-light'),
    [setting, prefersDark],
  );

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  return resolved;
}
