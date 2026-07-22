import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { usePetStore } from '@/stores/petStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { notifications } from '@/services/notifications';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { combineUnlisteners, emitTauriEvent, subscribeTauriEvent, subscribeTauriListener } from '@/utils/tauriEvents';
import { projectSessionActivity } from '@/utils/sessionPresentation';
import {
  isVoiceActivePhase,
  selectDynamicIslandTasks,
  shouldShowDynamicIsland,
  type DynamicIslandDrop,
  type DynamicIslandSessionActivity,
  type DynamicIslandSnapshot,
} from './model';

type IslandAction =
  | { type: 'open-task'; taskId: string }
  | { type: 'open-session'; sessionKey: string }
  | { type: 'toggle-dnd' }
  | { type: 'pomodoro-toggle' }
  | { type: 'pomodoro-stop' }
  | { type: 'voice-stop' }
  | { type: 'hide' };

export default function DynamicIslandRuntime() {
  const { t } = useTranslation();
  const enabled = useSettingsStore((state) => state.dynamicIslandEnabled);
  const autoExpand = useSettingsStore((state) => state.dynamicIslandAutoExpand);
  const dndMode = useSettingsStore((state) => state.dndMode);
  const connected = useChatStore((state) => state.connected);
  const connecting = useChatStore((state) => state.connecting);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const chatSessions = useChatStore((state) => state.sessions);
  const typingBySession = useChatStore((state) => state.typingBySession);
  const typingStartedAtBySession = useChatStore((state) => state.typingStartedAtBySession);
  const thinkingBySession = useChatStore((state) => state.thinkingBySession);
  const sendingBySession = useChatStore((state) => state.sendingBySession);
  const gatewayAgents = useGatewayDataStore((state) => state.agents);
  const localVoicePhase = useVoiceStore((state) => state.phase);
  const localVoiceQueueLength = useVoiceStore((state) => state.queueLength);
  const remoteVoiceOutput = useVoiceStore((state) => state.remoteOutput);
  const voicePhase = remoteVoiceOutput ? 'speaking' : localVoicePhase;
  const voiceQueueLength = remoteVoiceOutput ? 0 : localVoiceQueueLength;
  const tasks = useAgentWorkspaceStore((state) => state.tasks);
  const pomodoro = usePetStore((state) => state.pomodoro);
  const petEnabled = usePetStore((state) => state.enabled);
  const latestToast = useNotificationStore((state) => state.toasts.at(-1) ?? null);
  const revisionRef = useRef(0);
  const [mainMinimized, setMainMinimized] = useState(false);
  const [resourceDrop, setResourceDrop] = useState<DynamicIslandDrop | null>(null);
  const [terminalPulse, setTerminalPulse] = useState(false);
  const resourceDropRef = useRef(resourceDrop);
  const resourceDropTimerRef = useRef<number | null>(null);
  const terminalPulseTimerRef = useRef<number | null>(null);
  const previousTaskStatusesRef = useRef<Map<string, string> | null>(null);
  resourceDropRef.current = resourceDrop;

  const visibleTasks = useMemo(() => selectDynamicIslandTasks(tasks), [tasks]);
  const activityProjection = useMemo(() => projectSessionActivity({
    sessions: chatSessions,
    activeSessionKey,
    typingBySession,
    typingStartedAtBySession,
    thinkingBySession,
    sendingBySession,
  }), [activeSessionKey, chatSessions, sendingBySession, thinkingBySession, typingBySession, typingStartedAtBySession]);
  const sessionActivities = useMemo<DynamicIslandSessionActivity[]>(() => {
    const observedAt = Date.now();
    return activityProjection.active.map((activity) => {
      const { sessionKey, session } = activity;
      const agentId = session?.agentId || sessionKey.split(':')[1] || 'main';
      const agentName = gatewayAgents.find((agent) => agent.id === agentId)?.name || agentId;
      const title = session?.topic?.trim()
        || session?.label?.trim()
        || (agentId === 'main'
          ? t('chat.currentSession')
          : t('chat.agentSession', { agent: agentName }));
      const phase: DynamicIslandSessionActivity['phase'] = activity.phase === 'thinking'
        ? 'thinking'
        : 'generating';
      return {
        sessionKey,
        agentName,
        sessionTitle: title,
        phase,
        startedAt: activity.startedAt ?? observedAt,
      };
    });
  }, [activityProjection, gatewayAgents, t]);
  const sessionRunning = activityProjection.active.length > 0;
  const voiceActive = isVoiceActivePhase(voicePhase);
  const shouldShow = shouldShowDynamicIsland({
    enabled,
    mainMinimized,
    sessionRunning,
    voiceActive,
    tasks: visibleTasks,
    resourceDrop,
    terminalPulse,
  });

  useEffect(() => {
    const previous = previousTaskStatusesRef.current;
    previousTaskStatusesRef.current = new Map(visibleTasks.map((task) => [task.id, task.status]));
    if (!previous) return;
    const reachedTerminalState = visibleTasks.some((task) => (
      previous.get(task.id) !== task.status
      && (task.status === 'done' || task.status === 'failed' || task.status === 'interrupted')
    ));
    if (!reachedTerminalState) return;
    if (terminalPulseTimerRef.current !== null) window.clearTimeout(terminalPulseTimerRef.current);
    setTerminalPulse(true);
    terminalPulseTimerRef.current = window.setTimeout(() => {
      setTerminalPulse(false);
      terminalPulseTimerRef.current = null;
    }, 5_400);
  }, [visibleTasks]);

  const snapshot = useMemo<DynamicIslandSnapshot>(() => ({
    revision: ++revisionRef.current,
    sessionKey: activeSessionKey,
    connected,
    connecting,
    sessionRunning,
    sessionActivities,
    voicePhase,
    voiceQueueLength,
    petEnabled,
    dndMode,
    autoExpand,
    tasks: visibleTasks,
    pomodoro: {
      enabled: pomodoro.enabled,
      running: pomodoro.running,
      paused: pomodoro.paused,
      phase: pomodoro.phase,
      endsAt: pomodoro.endsAt,
      pausedRemainingMs: pomodoro.pausedRemainingMs,
    },
    notice: latestToast ? {
      id: latestToast.id,
      type: latestToast.type,
      title: latestToast.title,
      body: latestToast.body,
    } : null,
    resourceDrop,
  }), [activeSessionKey, autoExpand, connected, connecting, dndMode, latestToast, petEnabled, pomodoro, resourceDrop, sessionActivities, sessionRunning, visibleTasks, voicePhase, voiceQueueLength]);
  const latestSnapshotRef = useRef(snapshot);
  latestSnapshotRef.current = snapshot;

  useEffect(() => {
    if (shouldShow) {
      const openAndSynchronize = async () => {
        await invoke('open_dynamic_island');
        await invoke('set_dynamic_island_click_through', { ignore: resourceDropRef.current?.phase === 'dragging' }).catch(() => undefined);
        await emitTauriEvent('dynamic-island:update', latestSnapshotRef.current);
      };
      void openAndSynchronize().catch(() => undefined);
    } else {
      void invoke('close_dynamic_island').catch(() => undefined);
    }
  }, [shouldShow]);

  useEffect(() => {
    if (!shouldShow) return;
    void emitTauriEvent('dynamic-island:update', snapshot).catch(() => undefined);
  }, [shouldShow, snapshot]);

  useEffect(() => {
    let active = true;
    const mainWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    const refresh = () => {
      void mainWindow.isMinimized()
        .then((minimized) => { if (active) setMainMinimized(minimized); })
        .catch(() => { if (active) setMainMinimized(false); });
    };
    refresh();
    const onListenerError = () => {
      if (active) setMainMinimized(false);
    };
    unlisteners.push(
      subscribeTauriListener(() => mainWindow.onResized(refresh), onListenerError),
      subscribeTauriListener(() => mainWindow.onFocusChanged(refresh), onListenerError),
    );
    const fallbackTimer = window.setInterval(refresh, 1_000);
    return () => {
      active = false;
      window.clearInterval(fallbackTimer);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => combineUnlisteners([
    subscribeTauriEvent('dynamic-island:ready', () => {
      void emitTauriEvent('dynamic-island:update', latestSnapshotRef.current).catch(() => undefined);
    }),
    subscribeTauriEvent<string>('dynamic-island:navigate', (event) => {
      if (event.payload.startsWith('/') && !event.payload.includes('..')) {
        window.location.hash = event.payload;
      }
    }),
    subscribeTauriEvent<IslandAction>('dynamic-island:action', (event) => {
      const action = event.payload;
      switch (action.type) {
        case 'open-task':
          useAgentWorkspaceStore.getState().selectTask(action.taskId);
          void invoke('dynamic_island_focus_main', { route: '/ai-workspace' });
          break;
        case 'open-session': {
          const chat = useChatStore.getState();
          if (action.sessionKey && chat.sessions.some((session) => session.key === action.sessionKey)) {
            chat.setActiveSession(action.sessionKey);
          }
          void invoke('dynamic_island_focus_main', { route: '/chat' });
          break;
        }
        case 'toggle-dnd': {
          const next = !useSettingsStore.getState().dndMode;
          useSettingsStore.getState().setDndMode(next);
          notifications.setDndMode(next);
          break;
        }
        case 'pomodoro-toggle':
          if (usePetStore.getState().pomodoro.running) togglePausePomodoro();
          else startPomodoro();
          break;
        case 'pomodoro-stop':
          stopPomodoro();
          break;
        case 'voice-stop':
          voiceRuntime.interruptAll();
          break;
        case 'hide':
          useSettingsStore.getState().setDynamicIslandEnabled(false);
          break;
      }
    }),
    subscribeTauriEvent<string[]>('aegis:drag-active', (event) => {
      if (resourceDropTimerRef.current !== null) window.clearTimeout(resourceDropTimerRef.current);
      const labels = (event.payload ?? []).map((path) => path.split(/[\\/]/).pop() || path).slice(0, 3);
      setResourceDrop({ phase: 'dragging', count: event.payload?.length ?? 0, labels });
      void invoke('set_dynamic_island_click_through', { ignore: true }).catch(() => undefined);
    }),
    subscribeTauriEvent<string[]>('aegis:file-dropped', (event) => {
      if (resourceDropTimerRef.current !== null) window.clearTimeout(resourceDropTimerRef.current);
      const labels = (event.payload ?? []).map((path) => path.split(/[\\/]/).pop() || path).slice(0, 3);
      setResourceDrop({ phase: 'received', count: event.payload?.length ?? 0, labels });
      void invoke('set_dynamic_island_click_through', { ignore: false }).catch(() => undefined);
      resourceDropTimerRef.current = window.setTimeout(() => {
        setResourceDrop(null);
        resourceDropTimerRef.current = null;
      }, 3_600);
    }),
    subscribeTauriEvent('aegis:drag-inactive', () => {
      void invoke('set_dynamic_island_click_through', { ignore: false }).catch(() => undefined);
      window.setTimeout(() => {
        if (resourceDropRef.current?.phase === 'dragging') setResourceDrop(null);
      }, 80);
    }),
  ]), []);

  useEffect(() => () => {
    if (resourceDropTimerRef.current !== null) window.clearTimeout(resourceDropTimerRef.current);
    if (terminalPulseTimerRef.current !== null) window.clearTimeout(terminalPulseTimerRef.current);
  }, []);

  return null;
}
