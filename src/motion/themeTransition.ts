import { useSettingsStore } from '@/stores/settingsStore';
import { detectOSPreference, resolveTheme } from '@/theme/resolver';
import type { AegisTheme, ThemeSetting } from '@/theme/types';
import { circularViewTransition, type TransitionOrigin } from './circularViewTransition';

const LIGHT_THEMES = new Set<AegisTheme>(['aegis-light', 'aegis-eyecare']);

export function themeTransitionDirection(
  current: AegisTheme,
  target: AegisTheme,
): 'reveal' | 'conceal' {
  return LIGHT_THEMES.has(target) && !LIGHT_THEMES.has(current) ? 'conceal' : 'reveal';
}

export function setThemeWithTransition(theme: ThemeSetting, origin?: TransitionOrigin): void {
  const store = useSettingsStore.getState();
  if (store.theme === theme) return;

  const osTheme = detectOSPreference();
  const current = (document.documentElement.getAttribute('data-theme') as AegisTheme | null)
    ?? resolveTheme(store.theme, osTheme);
  const target = resolveTheme(theme, osTheme);
  if (current === target) {
    store.setTheme(theme);
    return;
  }

  void circularViewTransition.run({
    origin,
    direction: themeTransitionDirection(current, target),
    durationMs: 680,
    update: () => useSettingsStore.getState().setTheme(theme),
  });
}
