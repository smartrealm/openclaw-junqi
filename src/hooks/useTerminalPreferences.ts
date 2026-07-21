import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { hasTauriEventBridge } from '@/utils/tauriEvents';

export const DEFAULT_TERMINAL_SCROLLBACK = 1000;
export const DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE = true;
export const TERMINAL_SETTINGS_CHANGED_EVENT = 'junqi:app-settings-changed';

interface NativeTerminalPreferences {
  terminal_scrollback?: number;
  terminal_shift_enter_newline?: boolean;
}

export function useTerminalPreferences() {
  const available = hasTauriEventBridge();
  const [scrollback, setScrollback] = useState(DEFAULT_TERMINAL_SCROLLBACK);
  const [shiftEnterNewline, setShiftEnterNewline] = useState(DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!available) {
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const settings = await invoke<NativeTerminalPreferences>('load_app_settings');
      setScrollback(settings.terminal_scrollback ?? DEFAULT_TERMINAL_SCROLLBACK);
      setShiftEnterNewline(settings.terminal_shift_enter_newline ?? DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void reload();
    const handleChange = () => { void reload(); };
    window.addEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, handleChange);
  }, [reload]);

  return { scrollback, shiftEnterNewline, loading, error, available, reload };
}
