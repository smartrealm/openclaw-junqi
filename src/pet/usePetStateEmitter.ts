import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePetStore } from '@/stores/petStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useAppStore } from '@/stores/app-store';
import { useVoiceStore } from '@/stores/voiceStore';
import { isCronSessionKey, isIsolatedExecutionSessionKey } from '@/utils/sessionPresentation';
import { derivePetState, type CelebrateKind, type PetState } from './pet-states';
import i18n from '@/i18n';

const FAST_TICK_MS = 250;
const ACTIVE_TICK_MS = 1_000;
const IDLE_TICK_MS = 5_000;
const WAKE_DEBOUNCE_MS = 100;

// Module-level guard: React StrictMode double-invokes effects in dev. Without
// this (and the Rust-side PET_CREATE_GUARD), open_pet_window fires twice and
// can spawn two pet windows.
let petWindowOpened = false;

function localizedSetupMessage(app: ReturnType<typeof useAppStore.getState>): string {
  switch (app.setupStep) {
    case 'welcome':
      return i18n.t('setup.petWelcome', { defaultValue: 'Choose language and theme' });
    case 'detecting':
      return i18n.t('setup.detecting', { defaultValue: 'Detecting OpenClaw installation...' });
    case 'storage':
      return i18n.t('storage.title', { defaultValue: 'Choose OpenClaw data location' });
    case 'choosing-mode':
      return i18n.t('setup.chooseMode', { defaultValue: 'Choose how you want to set up the OpenClaw Gateway.' });
    case 'gateway-stopped':
      return i18n.t('setup.gatewayNotRunning', { defaultValue: 'Gateway is not running. Click below to start it.' });
    case 'git-missing':
      return i18n.t('setup.gitRequired', { defaultValue: 'Git Required' });
    case 'checking':
      return i18n.t('setup.detecting', { defaultValue: 'Checking requirements...' });
    case 'install-git':
      return i18n.t('setup.installingGit', { defaultValue: 'Installing Git...' });
    case 'install-node':
      return i18n.t('setup.installingNode', { defaultValue: 'Installing Node.js...' });
    case 'install-openclaw':
      return i18n.t('setup.installingOpenclaw', { defaultValue: 'Installing OpenClaw...' });
    case 'gateway-ready':
      return i18n.t('setup.gatewayConnected', { defaultValue: 'Gateway is ready' });
    case 'configure-openclaw':
      return i18n.t('setup.preparingGateway', { defaultValue: 'Preparing Gateway...' });
    case 'ready':
      return i18n.t('setup.ready', { defaultValue: 'Ready!' });
    case 'error':
      return i18n.t('pet.status.error', { defaultValue: 'Error' });
    default:
      return i18n.t('setup.settingUp', { defaultValue: 'Setting up JunQi Desktop' });
  }
}

function setupStepTitleKey(step: ReturnType<typeof useAppStore.getState>['setupStep']): string {
  switch (step) {
    case 'welcome':
      return 'setup.steps.identity.title';
    case 'detecting':
    case 'storage':
    case 'gateway-stopped':
    case 'choosing-mode':
      return 'setup.steps.runtime.title';
    case 'ready':
      return 'setup.steps.ready.title';
    case 'checking':
    case 'install-git':
    case 'git-missing':
    case 'install-node':
    case 'install-openclaw':
    case 'error':
    default:
      return 'setup.steps.install.title';
  }
}

function setupStepTitle(app: ReturnType<typeof useAppStore.getState>): string {
  return i18n.t(setupStepTitleKey(app.setupStep), {
    defaultValue: i18n.t('setup.settingUp', { defaultValue: 'Setting up JunQi Desktop' }),
  });
}

function setupPetCopy(app: ReturnType<typeof useAppStore.getState>): { taskLabel: string; message: string } {
  if (app.setupStep === 'ready') {
    return {
      taskLabel: i18n.t('setup.ready', { defaultValue: 'Ready!' }),
      message: i18n.t('setup.petReadyHint', { defaultValue: 'You can enter the workspace now.' }),
    };
  }

  return {
    taskLabel: setupStepTitle(app),
    message: localizedSetupMessage(app),
  };
}

function setupEmotion(app: ReturnType<typeof useAppStore.getState>): PetState['emotion'] {
  if (app.setupStep === 'error') return 'error';
  if (app.setupStep === 'ready') return 'happy';
  return 'working';
}

function petStateKey(state: PetState): string {
  const pomodoro = state.pomodoro
    ? {
        ...state.pomodoro,
        remainingSec: Math.ceil(state.pomodoro.remainingMs / 1000),
        remainingMs: undefined,
      }
    : undefined;
  return JSON.stringify({
    emotion: state.emotion,
    progress: typeof state.progress === 'number' ? Math.round(state.progress) : undefined,
    message: state.message,
    taskLabel: state.taskLabel,
    celebrateUntil: state.celebrateUntil,
    elapsedSec: state.elapsedMs ? Math.floor(state.elapsedMs / 1000) : undefined,
    skin: state.skin,
    setup: state.setup,
    pomodoro,
    celebrateKind: state.celebrateKind,
    drag: state.drag,
  });
}

function nextTickDelay(state: PetState): number {
  if (
    state.emotion === 'drag' ||
    state.emotion === 'overdrag' ||
    state.emotion === 'swallow' ||
    state.emotion === 'rapidSwallow'
  ) {
    return FAST_TICK_MS;
  }
  if (
    state.setup ||
    state.pomodoro?.running ||
    state.emotion === 'thinking' ||
    state.emotion === 'typing' ||
    state.emotion === 'tool' ||
    state.emotion === 'working' ||
    state.emotion === 'memory' ||
    state.emotion === 'happy' ||
    state.emotion === 'celebrate'
  ) {
    return ACTIVE_TICK_MS;
  }
  return IDLE_TICK_MS;
}

/**
 * Runs in the MAIN window (single source of truth). Opens the pet window when
 * enabled and broadcasts a `PetState` derived from the live business stores
 * on an adaptive cadence. Edge transitions (reply ended / task done / pomodoro phase
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
      lastDragEnterTs: number;
      lastDragLeaveTs: number;
    } = {
      lastReplyTs: 0,
      lastTaskDoneTs: 0,
      lastCompactionTs: 0,
      lastActivityTs: Date.now(),
      activeStartedAt: 0,
      prevPomoDoneTs: 0,
      lastPomoDoneKind: 'pomodoroWork',
      lastSwallowTs: 0,
      lastDragEnterTs: 0,
      lastDragLeaveTs: 0,
    };
    let prevTyping = Object.values(useChatStore.getState().typingBySession).some(Boolean);
    let prevDone = useWorkshopStore.getState().tasks.filter((t) => t.status === 'done').length;
    let prevActive = false;
    let prevSwallowTick = usePetStore.getState().swallowTick;
    let prevDragActive = usePetStore.getState().dragActive;

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let lastEmittedKey = '';
    let wakeQueued = false;

    const emitIfChanged = (state: PetState) => {
      const key = petStateKey(state);
      if (key === lastEmittedKey) return;
      lastEmittedKey = key;
      emitPetState(state);
    };

    const tick = (): PetState => {
      const now = Date.now();
      const cs = useChatStore.getState();
      const gw = useGatewayDataStore.getState();
      const ws = useWorkshopStore.getState();
      const app = useAppStore.getState();
      if (app.setupComplete !== true) {
        if (!mem.activeStartedAt) mem.activeStartedAt = now;
        const setupCopy = setupPetCopy(app);
        const state: PetState = {
          emotion: setupEmotion(app),
          progress: app.setupProgress,
          message: setupCopy.message,
          taskLabel: setupCopy.taskLabel,
          elapsedMs: mem.activeStartedAt ? now - mem.activeStartedAt : undefined,
          skin: usePetStore.getState().skin,
          setup: true,
        };
        emitIfChanged(state);
        return state;
      }

      const typing = Object.values(cs.typingBySession).some(Boolean);
      const thinking = Object.values(cs.thinkingBySession).some((e) => (e?.text?.length ?? 0) > 0);
      const voice = useVoiceStore.getState();
      const voiceListening = voice.phase === 'listening' || voice.phase === 'transcribing';
      const voiceSpeaking = voice.remoteOutput !== null || voice.phase === 'queued' || voice.phase === 'speaking';
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
      const conversationalRunning = runningSessions.filter(
        (session) => !isIsolatedExecutionSessionKey(String(session?.key || '')),
      );
      const backgroundRunning = runningSessions.filter(
        (session) => isCronSessionKey(String(session?.key || '')),
      );
      const hasHighPriorityWork = typing || thinking || tool || voiceListening || voiceSpeaking
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

      // Edge: drag-enter / drag-leave. We only care about the transitions
      // (true→false / false→true); mid-drag updates flow through the store
      // and are read on every tick.
      const dragActive = usePetStore.getState().dragActive;
      if (dragActive !== prevDragActive) {
        if (dragActive) mem.lastDragEnterTs = now;
        else mem.lastDragLeaveTs = now;
        prevDragActive = dragActive;
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
        voiceListening,
        voiceSpeaking,
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
        lastDragEnterTs: mem.lastDragEnterTs,
        lastDragLeaveTs: mem.lastDragLeaveTs,
        dragOver: usePetStore.getState().dragOver,
        dragCount: usePetStore.getState().dragCount,
        dragKind: usePetStore.getState().dragKind,
        recentSwallowTss: usePetStore.getState().swallowHistory,
      });
      const emotion = derived.emotion;

      // "What is it doing right now" → second line of the bubble.
      let message: string | undefined;
      let taskLabel: string | undefined;
      if (emotion === 'thinking') {
        message = voiceListening
          ? i18n.t('voice.runtimeListening', { defaultValue: '聆听中' })
          : (cs.thinkingBySession[cs.activeSessionKey]?.text || '').slice(0, 60) || undefined;
        taskLabel = activeAgentName;
      } else if (emotion === 'typing' && voiceSpeaking && !typing) {
        message = i18n.t('voice.runtimeSpeaking', { defaultValue: '语音回复中' });
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

      const state: PetState = {
        ...derived,
        message,
        taskLabel,
        elapsedMs: mem.activeStartedAt ? now - mem.activeStartedAt : undefined,
        skin: usePetStore.getState().skin,
        pomodoro: pomodoro.enabled
          ? { running: pomodoro.running, paused: pomodoro.paused, phase: pomodoro.phase, remainingMs, enabled: true }
          : undefined,
      };
      emitIfChanged(state);
      return state;
    };

    let loop: () => void;

    const scheduleNext = (state: PetState) => {
      if (stopped) return;
      timerId = setTimeout(loop, nextTickDelay(state));
    };
    loop = () => {
      if (stopped) return;
      wakeQueued = false;
      scheduleNext(tick());
    };

    const wake = () => {
      if (stopped || wakeQueued) return;
      wakeQueued = true;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      setTimeout(loop, WAKE_DEBOUNCE_MS);
    };

    const unsubs = [
      useChatStore.subscribe(wake),
      useGatewayDataStore.subscribe(wake),
      useWorkshopStore.subscribe(wake),
      usePetStore.subscribe(wake),
      useAppStore.subscribe(wake),
      useVoiceStore.subscribe(wake),
    ];

    loop();
    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
      unsubs.forEach((unsub) => unsub());
    };
  }, [enabled]);
}

/** Push a PetState to every window via the Rust bridge. No-op outside Tauri. */
export function emitPetState(state: PetState): void {
  invoke('emit_pet_state', { state }).catch(() => undefined);
}
