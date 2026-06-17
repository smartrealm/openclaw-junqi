import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePetStore } from '@/stores/petStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { derivePetState, type PetState } from './pet-states';

const TICK_MS = 250;

// Module-level guard: React StrictMode double-invokes effects in dev. Without
// this (and the Rust-side PET_CREATE_GUARD), open_pet_window fires twice and
// can spawn two pet windows.
let petWindowOpened = false;

/**
 * Runs in the MAIN window (single source of truth). Opens the pet window when
 * enabled and broadcasts a `PetState` derived from the live business stores
 * every TICK_MS. Edge transitions (reply ended / task done / compaction) are
 * detected by diffing against the previous tick and timestamped, so the pure
 * `derivePetState` can surface transient emotions.
 */
export function usePetStateEmitter() {
  const enabled = usePetStore((s) => s.enabled);

  useEffect(() => {
    if (!enabled) {
      petWindowOpened = false;
      invoke('close_pet_window').catch(() => undefined);
      return;
    }
    if (!petWindowOpened) {
      petWindowOpened = true;
      invoke('open_pet_window').catch(() => undefined);
    }

    const mem = {
      lastReplyTs: 0,
      lastTaskDoneTs: 0,
      lastCompactionTs: 0,
      lastActivityTs: Date.now(),
    };
    let prevTyping = Object.values(useChatStore.getState().typingBySession).some(Boolean);
    let prevDone = useWorkshopStore.getState().tasks.filter((t) => t.status === 'done').length;

    const tick = () => {
      const now = Date.now();
      const cs = useChatStore.getState();
      const gw = useGatewayDataStore.getState();
      const ws = useWorkshopStore.getState();

      const typing = Object.values(cs.typingBySession).some(Boolean);
      const thinking = Object.values(cs.thinkingBySession).some((e) => (e?.text?.length ?? 0) > 0);
      const running = gw.sessions.some((s) => s.running) || gw.runningSubAgents.length > 0;

      // Edge: a reply finalized when typing dropped true → false.
      if (!typing && prevTyping) mem.lastReplyTs = now;
      if (typing || thinking || running) mem.lastActivityTs = now;

      const done = ws.tasks.filter((t) => t.status === 'done').length;
      if (done > prevDone) mem.lastTaskDoneTs = now;

      prevTyping = typing;
      prevDone = done;

      emitPetState(
        derivePetState({
          connected: cs.connected,
          connectionError: cs.connectionError,
          thinking,
          typing,
          running,
          lastReplyTs: mem.lastReplyTs,
          lastTaskDoneTs: mem.lastTaskDoneTs,
          lastCompactionTs: mem.lastCompactionTs,
          lastActivityTs: mem.lastActivityTs,
          now,
          progress: cs.tokenUsage?.percentage ?? 0,
          message: thinking ? (cs.thinkingText || '').slice(0, 80) : undefined,
          taskLabel: gw.runningSubAgents[0]?.label,
        }),
      );
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);
}

/** Push a PetState to every window via the Rust bridge. No-op outside Tauri. */
export function emitPetState(state: PetState): void {
  invoke('emit_pet_state', { state }).catch(() => undefined);
}
