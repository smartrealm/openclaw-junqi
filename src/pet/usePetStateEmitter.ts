import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePetStore } from '@/stores/petStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { derivePetState, type CelebrateKind, type PetState } from './pet-states';
import i18n from '@/i18n';

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
      lastSwallowTs: number;
    } = {
      lastReplyTs: 0,
      lastTaskDoneTs: 0,
      lastCompactionTs: 0,
      lastActivityTs: Date.now(),
      activeStartedAt: 0,
      prevPomoDoneTs: 0,
      lastPomoDoneKind: 'pomodoroWork',
      lastSwallowTs: 0,
    };
    let prevTyping = Object.values(useChatStore.getState().typingBySession).some(Boolean);
    let prevDone = useWorkshopStore.getState().tasks.filter((t) => t.status === 'done').length;
    let prevActive = false;
    let prevSwallowTick = usePetStore.getState().swallowTick;

    const tick = () => {
      const now = Date.now();
      const cs = useChatStore.getState();
      const gw = useGatewayDataStore.getState();
      const ws = useWorkshopStore.getState();

      const typing = Object.values(cs.typingBySession).some(Boolean);
      const thinking = Object.values(cs.thinkingBySession).some((e) => (e?.text?.length ?? 0) > 0);
      const tool = cs.messages.some((m) => m.toolStatus === 'running');
      // "working" means an agent is actively running. `session.running` is the
      // authoritative state set by real-time events (session.running / stopped /
      // task-status); polls only carry it forward and never mint a timestamp.
      //
      // Previously a 2-minute ceiling on runningUpdatedAt dropped long-running
      // agents back to idle during quiet reasoning gaps — but `running:true` IS
      // the signal that an agent is working, so we must not second-guess it with
      // a timeout. The only stale case to reject is cold-boot residue: a session
      // whose running=true came from an old poll with NO event-driven timestamp
      // (runningUpdatedAt === 0). Any real running session has a timestamp.
      // chatStore.Session has no runningUpdatedAt field, so only gatewayDataStore
      // sessions can be trusted for "working" detection (running flag there is
      // set by real-time events with an event-driven timestamp). Don't merge a
      // cs.sessions branch that would be dead code.
      const isFreshRunning = (s: any) => {
        if (!s?.running) return false;
        return Number(s.runningUpdatedAt || 0) > 0;
      };
      const runningSessions = gw.sessions.filter(isFreshRunning);

      // Distinguish high-priority conversational work from low-priority
      // background maintenance (memory dreaming cron). A cron session key looks
      // like "agent:<id>:cron:<uuid>". Dreaming runs at lowest priority: it
      // only keeps the pet "working" when nothing else is active.
      const isCronSession = (s: any) => String(s?.key || '').includes(':cron:');
      const conversationalRunning = runningSessions.filter((s) => !isCronSession(s));
      const backgroundRunning = runningSessions.filter((s) => isCronSession(s));
      const hasHighPriorityWork = typing || thinking || tool
        || conversationalRunning.length > 0 || gw.runningSubAgents.length > 0;
      const backgroundWork = !hasHighPriorityWork && backgroundRunning.length > 0;

      const running = hasHighPriorityWork || backgroundWork;
      const isActive = running;

      // Which agent is the pet "working for" right now? Prefer the active
      // conversational agent; fall back to sub-agent label; dreaming is a
      // background task with no specific agent.
      const activeAgentId = conversationalRunning[0]
        ? (String(conversationalRunning[0].key || '').split(':')[1] || 'main')
        : (gw.runningSubAgents[0]?.agentId || 'main');
      const activeAgentName = gw.agents.find((a) => a.id === activeAgentId)?.name || activeAgentId;

      // Track when the current stretch of activity began (for the elapsed timer).
      if (isActive && !prevActive) mem.activeStartedAt = now;
      if (!isActive) mem.activeStartedAt = 0;
      prevActive = isActive;

      // Edge: a reply finalized when typing dropped true → false.
      if (!typing && prevTyping) mem.lastReplyTs = now;
      if (isActive) mem.lastActivityTs = now;

      // Edge: user dropped a file onto the pet/main → bump swallow timestamp.
      // Driven by the petStore's swallowTick counter (set from App.tsx after
      // open_quickchat_with_files resolves), so the swallow is observable
      // synchronously with the QuickChat window appearing.
      const swallowTick = usePetStore.getState().swallowTick;
      if (swallowTick !== prevSwallowTick) {
        mem.lastSwallowTs = now;
        prevSwallowTick = swallowTick;
      }

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
        running: hasHighPriorityWork,
        backgroundWork,
        lastReplyTs: mem.lastReplyTs,
        lastTaskDoneTs: mem.lastTaskDoneTs,
        lastCompactionTs: mem.lastCompactionTs,
        pomodoroDoneTs: pomodoro.lastDoneTs,
        pomodoroDoneKind: mem.lastPomoDoneKind,
        lastSwallowTs: mem.lastSwallowTs,
        swallowTick: swallowTick,
        lastActivityTs: mem.lastActivityTs,
        now,
        progress: cs.tokenUsage?.percentage ?? 0,
      });
      const emotion = derived.emotion;

      // "What is it doing right now" → second line of the bubble.
      let message: string | undefined;
      let taskLabel: string | undefined;
      if (emotion === 'thinking') {
        message = (cs.thinkingText || '').slice(0, 60) || undefined;
        taskLabel = activeAgentName;
      } else if (emotion === 'working') {
        if (hasHighPriorityWork) {
          // Show which agent is handling the conversation / sub-task.
          taskLabel = activeAgentName;
          message = gw.runningSubAgents[0]?.label || conversationalRunning[0]?.label || activeAgentName;
        } else if (backgroundWork) {
          // Dreaming / memory maintenance — no specific agent.
          taskLabel = undefined;
          message = (i18n.t('pet.dreaming', { defaultValue: '梦境整理中' }) as string);
        }
      }

      emitPetState({
        ...derived,
        message,
        taskLabel,
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
