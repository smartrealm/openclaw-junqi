import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { cycleSkin, startPomodoro, stopPomodoro, togglePausePomodoro, type PetMenuKind } from './petActions';
import { usePetStore } from '@/stores/petStore';
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';

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
    const unlistens = [
      subscribeTauriEvent<{ kind: PetMenuKind }>('pet-action', (e) => {
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
      }),
    ];
    // Mirror pet-window visibility into the store so the settings-page recall
    // button can label itself "Show" vs "Hide".
    unlistens.push(
      subscribeTauriEvent<{ visible: boolean }>('pet-visibility', (e) => {
        usePetStore.getState().setPetVisible(e.payload.visible);
      }),
    );
    // Initialize from the pet window's current visibility (covers cold start).
    invoke<boolean>('get_pet_visible')
      .then((v) => usePetStore.getState().setPetVisible(v))
      .catch(() => undefined);
    return combineUnlisteners(unlistens);
  }, []);
}
