/**
 * usePrefersDark — reactive wrapper around `(prefers-color-scheme: dark)`.
 *
 * Returns true if the OS is currently in dark mode; re-renders the
 * caller when the OS preference flips. Use this when a component needs
 * to react to OS theme changes WITHOUT going through the app's theme
 * setting (e.g. the "Following system · {mode}" chip).
 *
 * For the resolved app theme, prefer the higher-level `useTheme()`
 * hook in @/theme — this one is purely about the OS hint.
 */
import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function readOnce(): boolean {
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return true; // SSR / sandboxed — assume dark to match our default theme
  }
}

export function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState<boolean>(readOnce);

  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(QUERY);
    } catch {
      return; // no matchMedia — nothing to subscribe to
    }
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return prefersDark;
}
