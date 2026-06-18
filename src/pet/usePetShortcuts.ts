import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePetStore } from '@/stores/petStore';
import { startPomodoro, togglePausePomodoro } from './petActions';

/**
 * Local keyboard shortcuts, active while the MAIN window is focused. Global
 * shortcuts would need OS permissions and risk clashing with other apps; these
 * only fire on keydown in this window.
 *
 *   ⌘/Ctrl+Shift+P → start the Pomodoro, or pause/resume if it's running
 *   ⌘/Ctrl+Shift+H → show / hide the pet
 */
export function usePetShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      switch (e.key.toLowerCase()) {
        case 'p': {
          const p = usePetStore.getState().pomodoro;
          if (!p.enabled) return;
          e.preventDefault();
          if (!p.running) startPomodoro();
          else togglePausePomodoro();
          break;
        }
        case 'h': {
          e.preventDefault();
          invoke('toggle_pet_window').catch(() => undefined);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
