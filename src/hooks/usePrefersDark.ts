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
import { hasTauriEventBridge, subscribeTauriListener } from '@/utils/tauriEvents';

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
    let active = true;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(QUERY);
    } catch {
      return; // no matchMedia — nothing to subscribe to
    }
    const update = (dark: boolean) => {
      if (active) setPrefersDark(dark);
    };
    const onChange = (event: MediaQueryListEvent) => update(event.matches);
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else mq.addListener(onChange);

    const releaseNative = hasTauriEventBridge()
      ? subscribeTauriListener(async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        const unlisten = await currentWindow.onThemeChanged(({ payload }) => update(payload === 'dark'));
        void currentWindow.theme().then((theme) => {
          if (theme) update(theme === 'dark');
        }).catch(() => undefined);
        return unlisten;
      })
      : () => {};

    return () => {
      active = false;
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
      releaseNative();
    };
  }, []);

  return prefersDark;
}
