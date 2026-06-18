import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { cycleSkin, startPomodoro, stopPomodoro, togglePausePomodoro, type PetMenuKind } from './petActions';

/**
 * Runs in the MAIN window. The pet window is a thin client — when the user
 * interacts with it (single-click to cycle skins, or a right-click menu item),
 * it (or the Rust native menu) emits a "pet-action" event; this hook performs
 * the actual state change here, where the live timer and the authoritative
 * store live. Skin/pomodoro changes then propagate back to the pet window via
 * the next `pet-state` emit.
 */
export function usePetActions() {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<{ kind: PetMenuKind }>('pet-action', (e) => {
      switch (e.payload.kind) {
        case 'showMain':
          invoke('pet_focus_main').catch(() => undefined);
          break;
        case 'hide':
          invoke('close_pet_window').catch(() => undefined);
          break;
        case 'nextSkin':
          cycleSkin();
          break;
        case 'pomoStart':
          startPomodoro();
          break;
        case 'pomoPause':
          togglePausePomodoro();
          break;
        case 'pomoStop':
          stopPomodoro();
          break;
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, []);
}
