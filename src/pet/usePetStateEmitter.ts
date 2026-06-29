import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePetStore } from '@/stores/petStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { derivePetState, type CelebrateKind, type PetState } from './pet-states';

const TICK_MS = 250;

// Module-level guard: React StrictMode double-invokes effects in dev. Without
// this (and the Rust-side PET_CREATE_GUARD), open_pet_window fires twice and
// can spawn two pet windows.
let petWindowOpened = false;

/**
 * Runs in the MAIN window (single source of truth). Opens the pet window when
 * enabled and broadcasts a `PetState` derived from the live business stores
 * every TICK_MS. Edge transitions (reply ended / task done / pomodoro phase
 * done / activity start) are detected by diffing against the previous tick and
 * timestamped, so the bubble can show what the pet is doing and for how long,
 * plus the live Pomodoro countdown.
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

    const mem: {
      lastReplyTs: number;
      lastTaskDoneTs: number;
      lastCompactionTs: number;
      lastActivityTs: number;
      activeStartedAt: number;
      prevPomoDoneTs: number;
      lastPomoDoneKind: CelebrateKind;
    } = {
      lastReplyTs: 0,
      lastTaskDoneTs: 0,
      lastCompactionTs: 0,
      lastActivityTs: Date.now(),
      activeStartedAt: 0,
      prevPomoDoneTs: 0,
      lastPomoDoneKind: 'pomodoroWork',
    };
    let prevTyping = Object.values(useChatStore.getState().typingBySession).some(Boolean);
    let prevDone = useWorkshopStore.getState().tasks.filter((t) => t.status === 'done').length;
    let prevActive = false;

    const tick = () => {
      const now = Date.now();
      const cs = useChatStore.getState();
      const gw = useGatewayDataStore.getState();
      const ws = useWorkshopStore.getState();

      const typing = Object.values(cs.typingBySession).some(Boolean);
      const thinking = Object.values(cs.thinkingBySession).some((e) => (e?.text?.length ?? 0) > 0);
      // GatewayDataStore is not the only source of truth anymore: App.tsx keeps
      // chatStore.sessions fresh from sessions.list, while gatewayDataStore may
      // lag or miss agent-bound sessions. Merge both so the pet reflects real
      // active work instead of idling while another agent is running.
      const RUNNING_STALE_MS = 2 * 60_000;
      const isFreshRunning = (s: any) => {
        if (!s?.running) return false;
        const updated = Number(s.runningUpdatedAt || 0);
        // Older records did not carry runningUpdatedAt; only trust them if there
        // is another live signal (typing/thinking/tool) or a very recent lastActive.
        if (!updated) {
          const lastActive = s.lastActive ? new Date(s.lastActive).getTime() : 0;
          return lastActive > 0 && now - lastActive < RUNNING_STALE_MS;
        }
        return now - updated < RUNNING_STALE_MS;
      };
      const runningSessions = [
        ...gw.sessions.filter(isFreshRunning),
        ...cs.sessions.filter(isFreshRunning),
      ];
      const running = runningSessions.length > 0 || gw.runningSubAgents.length > 0;
      const tool = cs.messages.some((m) => m.toolStatus === 'running');
      const isActive = typing || thinking || tool || running;

      // Track when the current stretch of activity began (for the elapsed timer).
      if (isActive && !prevActive) mem.activeStartedAt = now;
      if (!isActive) mem.activeStartedAt = 0;
      prevActive = isActive;

      // Edge: a reply finalized when typing dropped true → false.
      if (!typing && prevTyping) mem.lastReplyTs = now;
      if (isActive) mem.lastActivityTs = now;

      const done = ws.tasks.filter((t) => t.status === 'done').length;
      if (done > prevDone) mem.lastTaskDoneTs = now;

      prevTyping = typing;
      prevDone = done;

      // Pomodoro: on a fresh phase completion, classify which kind (so the
      // celebrate bubble shows a pomodoro-specific caption) and compute the
      // live remaining time for the countdown bubble.
      const pomodoro = usePetStore.getState().pomodoro;
      if (pomodoro.lastDoneTs && pomodoro.lastDoneTs !== mem.prevPomoDoneTs) {
        mem.prevPomoDoneTs = pomodoro.lastDoneTs;
        // After work→break the phase is 'break' (work just finished); after
        // break→work the phase is 'work' (break just finished). The 4th work
        // round (workRounds % 4 === 0) earns a long break.
        mem.lastPomoDoneKind =
          pomodoro.phase === 'break'
            ? pomodoro.workRounds > 0 && pomodoro.workRounds % 4 === 0
              ? 'pomodoroWorkLong'
              : 'pomodoroWork'
            : 'pomodoroBreak';
      }
      const remainingMs = pomodoro.running
        ? pomodoro.paused
          ? Math.max(0, pomodoro.pausedRemainingMs ?? 0)
          : Math.max(0, (pomodoro.endsAt ?? now) - now)
        : 0;

      const derived = derivePetState({
        connected: cs.connected,
        connectionError: cs.connectionError,
        thinking,
        typing,
        tool,
        running,
        lastReplyTs: mem.lastReplyTs,
        lastTaskDoneTs: mem.lastTaskDoneTs,
        lastCompactionTs: mem.lastCompactionTs,
        pomodoroDoneTs: pomodoro.lastDoneTs,
        pomodoroDoneKind: mem.lastPomoDoneKind,
        lastActivityTs: mem.lastActivityTs,
        now,
        progress: cs.tokenUsage?.percentage ?? 0,
      });
      const emotion = derived.emotion;

      // "What is it doing right now" → second line of the bubble.
      let message: string | undefined;
      const runningSessionLabel = runningSessions[0]?.label || runningSessions[0]?.key;
      if (emotion === 'thinking') message = (cs.thinkingText || '').slice(0, 60) || undefined;
      else if (emotion === 'working') message = gw.runningSubAgents[0]?.label || runningSessionLabel;

      emitPetState({
        ...derived,
        message,
        taskLabel: gw.runningSubAgents[0]?.label || runningSessionLabel,
        elapsedMs: mem.activeStartedAt ? now - mem.activeStartedAt : undefined,
        skin: usePetStore.getState().skin,
        pomodoro: pomodoro.enabled
          ? { running: pomodoro.running, paused: pomodoro.paused, phase: pomodoro.phase, remainingMs, enabled: true }
          : undefined,
      });
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
