import { AEGIS_THEMES, type AegisTheme } from './types';

export function nextTheme(current: AegisTheme): AegisTheme {
  const currentIndex = AEGIS_THEMES.indexOf(current);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % AEGIS_THEMES.length;
  return AEGIS_THEMES[nextIndex];
}
