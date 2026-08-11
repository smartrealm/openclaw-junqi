import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  ChevronUp,
  Clock3,
  FileCheck2,
  Files,
  ListChecks,
  MessageCircle,
  Pause,
  Play,
  Radio,
  Crosshair,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { combineUnlisteners, emitTauriEvent, subscribeTauriEvent } from '@/utils/tauriEvents';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { AgentActivityIndicator } from '@/components/shared/AgentActivityIndicator';
import {
  EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
  formatElapsedTime,
  isDynamicIslandVoiceInputActive,
  isVoiceActivePhase,
  formatRemainingTime,
  shouldPeekForSnapshot,
  resolveDynamicIslandAgentActivity,
  type DynamicIslandVoiceInput,
  type DynamicIslandSnapshot,
} from './model';
import './dynamic-island.css';
import { useTheme } from '@/theme/useTheme';
import { requestDynamicIslandHide } from '@/api/tauri-commands';
import { hideDynamicIsland, type DynamicIslandAction } from './DynamicIslandActions';

const COLLAPSE_DELAY_MS = 5_200;
const HOVER_EXPAND_DELAY_MS = 140;
const HOVER_COLLAPSE_DELAY_MS = 280;

function voiceInputTitleKey(input: DynamicIslandVoiceInput): string {
  if (input.phase === 'error') return 'dynamicIsland.voiceInputError';
  if (input.phase === 'preparing') return 'dynamicIsland.voicePreparing';
  if (input.phase === 'thinking') return 'dynamicIsland.processingVoice';
  if (input.phase === 'speaking') return 'dynamicIsland.speaking';
  return 'dynamicIsland.listening';
}

export default function DynamicIsland() {
  useTheme();
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(EMPTY_DYNAMIC_ISLAND_SNAPSHOT);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const previousSnapshotRef = useRef<DynamicIslandSnapshot | null>(null);
  const autoCollapseTimerRef = useRef<number | null>(null);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverCollapseTimerRef = useRef<number | null>(null);
  const clearAutoCollapse = useCallback(() => {
    if (autoCollapseTimerRef.current !== null) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  }, []);

  const clearHoverIntent = useCallback(() => {
    if (hoverExpandTimerRef.current !== null) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    if (hoverCollapseTimerRef.current !== null) {
      window.clearTimeout(hoverCollapseTimerRef.current);
      hoverCollapseTimerRef.current = null;
    }
  }, []);

  const setIslandExpanded = useCallback((next: boolean, autoCollapse = false) => {
    clearAutoCollapse();
    setExpanded(next);
    void invoke('set_dynamic_island_expanded', { expanded: next }).catch(() => undefined);
    if (next && autoCollapse) {
      autoCollapseTimerRef.current = window.setTimeout(() => {
        setExpanded(false);
        void invoke('set_dynamic_island_expanded', { expanded: false }).catch(() => undefined);
        autoCollapseTimerRef.current = null;
      }, COLLAPSE_DELAY_MS);
    }
  }, [clearAutoCollapse]);

  useEffect(() => {
    document.documentElement.classList.add('junqi-dynamic-island-document');
    document.body.classList.add('junqi-dynamic-island-document');
    const root = document.getElementById('app-root');
    root?.classList.add('junqi-dynamic-island-root');
    void emitTauriEvent('dynamic-island:ready').catch(() => undefined);

    const unsubscribe = combineUnlisteners([
      subscribeTauriEvent<DynamicIslandSnapshot>('dynamic-island:update', (event) => {
        const previous = previousSnapshotRef.current;
        const next = event.payload;
        previousSnapshotRef.current = next;
        setSnapshot(next);
        if (next.resourceDrop) {
          setIslandExpanded(true, next.resourceDrop.phase === 'received');
          return;
        }
        if (previous && shouldPeekForSnapshot(previous, next)) {
          setIslandExpanded(true, true);
        }
      }),
      subscribeTauriEvent('dynamic-island:opened', () => {
        void emitTauriEvent('dynamic-island:ready').catch(() => undefined);
      }),
    ]);
    return () => {
      unsubscribe();
      clearAutoCollapse();
      clearHoverIntent();
      document.documentElement.classList.remove('junqi-dynamic-island-document');
      document.body.classList.remove('junqi-dynamic-island-document');
      root?.classList.remove('junqi-dynamic-island-root');
    };
  }, [clearAutoCollapse, clearHoverIntent, setIslandExpanded]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded) setIslandExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded, setIslandExpanded]);

  useEffect(() => {
    if ((!snapshot.pomodoro.running || snapshot.pomodoro.paused) && snapshot.sessionActivities.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.pomodoro.paused, snapshot.pomodoro.running, snapshot.sessionActivities.length]);

  const action = useCallback((payload: DynamicIslandAction) => {
    void emitTauriEvent('dynamic-island:action', payload).catch(() => undefined);
  }, []);

  const requestHide = useCallback(
    () => hideDynamicIsland(
      requestDynamicIslandHide,
      (payload) => emitTauriEvent('dynamic-island:action', payload),
    ),
    [],
  );

  const primarySessionActivity = snapshot.sessionActivities[0];
  const outputVoiceActive = isVoiceActivePhase(snapshot.voicePhase);
  const inputVoiceActive = isDynamicIslandVoiceInputActive(snapshot.voiceInput);
  const voiceActive = outputVoiceActive || inputVoiceActive;
  const compactActivity = resolveDynamicIslandAgentActivity({
    voicePhase: snapshot.voicePhase,
    voiceInput: snapshot.voiceInput,
    sessionPhase: primarySessionActivity?.phase,
  });
  const remaining = formatRemainingTime(snapshot, now);
  const headline = useMemo(() => {
    if (snapshot.resourceDrop?.phase === 'dragging') {
      return t('dynamicIsland.readyForFiles', { count: snapshot.resourceDrop.count });
    }
    if (snapshot.resourceDrop?.phase === 'received') return t('dynamicIsland.filesSent');
    if (outputVoiceActive && (snapshot.voicePhase === 'speaking' || snapshot.voicePhase === 'queued')) return t('dynamicIsland.speaking');
    if (outputVoiceActive && (snapshot.voicePhase === 'listening' || snapshot.voicePhase === 'transcribing')) return t('dynamicIsland.listening');
    if (inputVoiceActive) return t(voiceInputTitleKey(snapshot.voiceInput));
    if (primarySessionActivity?.observer) return primarySessionActivity.observer.headline;
    if (primarySessionActivity) {
      return t(`dynamicIsland.agent.${primarySessionActivity.phase}`, { agent: primarySessionActivity.agentName });
    }
    if (snapshot.focus) return snapshot.focus.title;
    if (snapshot.connected) return t('dynamicIsland.ready');
    return snapshot.connecting ? t('dynamicIsland.connecting') : t('dynamicIsland.offline');
  }, [inputVoiceActive, outputVoiceActive, primarySessionActivity, snapshot.connected, snapshot.connecting, snapshot.focus, snapshot.resourceDrop, snapshot.voiceInput, snapshot.voicePhase, t]);
  const compactMeta = useMemo(() => {
    if (snapshot.pomodoro.running) {
      return t(snapshot.pomodoro.phase === 'work' ? 'dynamicIsland.focusSession' : 'dynamicIsland.breakSession');
    }
    if (primarySessionActivity?.observer) {
      return `${primarySessionActivity.agentName} · ${t(`dynamicIsland.observerHealth.${primarySessionActivity.observer.health}`)}`;
    }
    if (primarySessionActivity) {
      return t(`dynamicIsland.elapsed.${primarySessionActivity.phase}`, {
        elapsed: formatElapsedTime(primarySessionActivity.startedAt, now),
      });
    }
    if (snapshot.focus) {
      return `${t('dynamicIsland.focused')} - ${t(`focus.states.${snapshot.focus.state}`)}`;
    }
    if (outputVoiceActive && (snapshot.voicePhase === 'speaking' || snapshot.voicePhase === 'queued')) {
      return snapshot.voiceQueueLength > 0
        ? t('dynamicIsland.voiceQueue', { count: snapshot.voiceQueueLength })
        : t('dynamicIsland.voiceOutput');
    }
    if (outputVoiceActive && (snapshot.voicePhase === 'listening' || snapshot.voicePhase === 'transcribing')) return t('dynamicIsland.voiceInput');
    if (inputVoiceActive) return t('dynamicIsland.returnToChatToControlVoice');
    return t(snapshot.connected ? 'dynamicIsland.openclawOnline' : 'dynamicIsland.openclawStandby');
  }, [inputVoiceActive, now, outputVoiceActive, primarySessionActivity, snapshot.connected, snapshot.focus, snapshot.pomodoro.phase, snapshot.pomodoro.running, snapshot.voiceInput, snapshot.voicePhase, snapshot.voiceQueueLength, t]);

  return (
    <main
      className={`junqi-island-shell ${expanded ? 'is-expanded' : 'is-compact'} ${compactActivity ? 'has-agent-activity' : ''}`}
      onPointerEnter={() => {
        clearAutoCollapse();
        if (hoverCollapseTimerRef.current !== null) {
          window.clearTimeout(hoverCollapseTimerRef.current);
          hoverCollapseTimerRef.current = null;
        }
        if (!expanded && !snapshot.resourceDrop && hoverExpandTimerRef.current === null) {
          hoverExpandTimerRef.current = window.setTimeout(() => {
            hoverExpandTimerRef.current = null;
            setIslandExpanded(true);
          }, HOVER_EXPAND_DELAY_MS);
        }
      }}
      onPointerLeave={() => {
        if (hoverExpandTimerRef.current !== null) {
          window.clearTimeout(hoverExpandTimerRef.current);
          hoverExpandTimerRef.current = null;
        }
        if (expanded && !snapshot.resourceDrop && hoverCollapseTimerRef.current === null) {
          hoverCollapseTimerRef.current = window.setTimeout(() => {
            hoverCollapseTimerRef.current = null;
            setIslandExpanded(false);
          }, HOVER_COLLAPSE_DELAY_MS);
        }
      }}
    >
      <AnimatePresence initial={false} mode="wait">
        {!expanded ? (
          <motion.button
            key="compact"
            type="button"
            className="junqi-island-compact"
            onClick={() => setIslandExpanded(true)}
            aria-label={t('dynamicIsland.expand')}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="junqi-island-orb">
              {compactActivity ? (
                <AgentActivityIndicator
                  activity={compactActivity}
                  size={20}
                  decorative
                  className="junqi-island-primary-activity"
                />
              ) : (
                <JunQiLogo variant="emblem" className="junqi-island-brand-emblem" title="JunQi" />
              )}
            </span>
            <span className="junqi-island-compact-copy">
              <strong>{headline}</strong>
              <small>{compactMeta}</small>
            </span>
            <span className="junqi-island-compact-metrics">
              {remaining ? (
                <span className="junqi-island-timer"><Clock3 size={12} />{remaining}</span>
              ) : voiceActive ? (
                <span className="junqi-island-running">{inputVoiceActive ? <Radio size={12} /> : <Volume2 size={12} />}{snapshot.voiceQueueLength || ''}</span>
              ) : (
                <span className={`junqi-island-connection ${snapshot.connected ? 'is-online' : ''}`} />
              )}
            </span>
          </motion.button>
        ) : (
          <motion.section
            key="expanded"
            className="junqi-island-panel"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="junqi-island-header">
              <div className="junqi-island-title">
                <span className="junqi-island-brandmark"><Radio size={15} /></span>
                <span><strong>{headline}</strong><small>{snapshot.resourceDrop
                  ? t(snapshot.resourceDrop.phase === 'dragging' ? 'dynamicIsland.releaseFiles' : 'dynamicIsland.quickChatReady')
                  : inputVoiceActive
                    ? t('dynamicIsland.returnToChatToControlVoice')
                    : primarySessionActivity?.observer
                      ? t(`dynamicIsland.observerHealth.${primarySessionActivity.observer.health}`)
                      : t('dynamicIsland.currentActivity')}</small></span>
              </div>
              <div className="junqi-island-window-actions">
                <button type="button" onClick={() => setIslandExpanded(false)} title={t('dynamicIsland.collapse')}><ChevronUp size={15} /></button>
                <button
                  type="button"
                  onClick={() => { void requestHide().catch(() => undefined); }}
                  title={t('dynamicIsland.hide')}
                ><X size={15} /></button>
              </div>
            </header>

            <div className="junqi-island-content">
              <div className="junqi-island-task-list" aria-label={t('dynamicIsland.agentStatus')}>
                {snapshot.resourceDrop ? (
                  <div className={`junqi-island-drop is-${snapshot.resourceDrop.phase}`}>
                    <div className="junqi-island-drop-visual">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={snapshot.resourceDrop.phase}
                          initial={{ scale: 0.75, opacity: 0, y: 5 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 0.88, opacity: 0, y: -4 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                        >
                          {snapshot.resourceDrop.phase === 'dragging' ? <Files size={24} /> : <FileCheck2 size={24} />}
                        </motion.span>
                      </AnimatePresence>
                      <i />
                    </div>
                    <div className="junqi-island-drop-copy">
                      <strong>{snapshot.resourceDrop.phase === 'dragging'
                        ? t(snapshot.petEnabled ? 'dynamicIsland.petReceiving' : 'dynamicIsland.receivingFiles')
                        : t('dynamicIsland.transferComplete')}</strong>
                      <small>{snapshot.resourceDrop.labels.join(' · ') || t('dynamicIsland.fileResources')}</small>
                    </div>
                    <div className="junqi-island-drop-progress"><span /></div>
                  </div>
                ) : snapshot.executionPlan || snapshot.sessionActivities.length > 0 ? (
                  <>
                    {snapshot.executionPlan && (
                      <button
                        type="button"
                        className="junqi-island-task is-session"
                        onClick={() => action({ type: 'open-session', sessionKey: snapshot.sessionKey })}
                      >
                        <span className="junqi-island-task-icon is-running"><ListChecks size={13} /></span>
                        <span className="junqi-island-task-copy">
                          <strong>{t('dynamicIsland.executionPlanStep', {
                            current: snapshot.executionPlan.currentStep,
                            total: snapshot.executionPlan.totalSteps,
                          })}</strong>
                          <small>{snapshot.executionPlan.stepTitle}</small>
                        </span>
                        <ChevronUp size={13} className="junqi-island-task-open" />
                      </button>
                    )}
                    {snapshot.sessionActivities.slice(0, 2).map((activity) => (
                      <button key={activity.id} type="button" className="junqi-island-task is-session" onClick={() => action({ type: 'open-session', sessionKey: activity.sessionKey })}>
                        <span className="junqi-island-task-icon is-running">
                          <AgentActivityIndicator
                            activity={activity.phase === 'thinking' ? 'thinking' : activity.phase === 'generating' ? 'generating' : 'working'}
                            size={20}
                            decorative
                            className="junqi-island-activity-glyph"
                          />
                        </span>
                        <span className="junqi-island-task-copy">
                          <strong>{activity.observer?.headline ?? t(`dynamicIsland.agent.${activity.phase}`, { agent: activity.agentName })}</strong>
                          <small>{activity.observer
                            ? `${activity.agentName} · ${t(`dynamicIsland.observerHealth.${activity.observer.health}`)}`
                            : `${activity.sessionTitle} · ${t(`dynamicIsland.elapsed.${activity.phase}`, { elapsed: formatElapsedTime(activity.startedAt, now) })}`}</small>
                        </span>
                        <ChevronUp size={13} className="junqi-island-task-open" />
                      </button>
                    ))}
                  </>
                ) : snapshot.focus ? (
                  <button
                    type="button"
                    className="junqi-island-focus-card"
                    disabled={snapshot.focus.state === 'unavailable'}
                    onClick={() => action({ type: 'open-focus' })}
                  >
                    <span className={`junqi-island-task-icon is-focus is-${snapshot.focus.state}`}>
                      <Crosshair size={14} />
                    </span>
                    <span className="junqi-island-task-copy">
                      <strong>{snapshot.focus.title}</strong>
                      <small>{snapshot.focus.detail} - {t(`focus.states.${snapshot.focus.state}`)}</small>
                    </span>
                    <ChevronUp size={13} className="junqi-island-task-open" />
                  </button>
                ) : inputVoiceActive ? (
                  <div className="junqi-island-empty">
                    <Radio size={18} />
                    <span><strong>{t(voiceInputTitleKey(snapshot.voiceInput))}</strong><small>{t('dynamicIsland.returnToChatToControlVoice')}</small></span>
                  </div>
                ) : outputVoiceActive ? (
                  <div className="junqi-island-empty">
                    <Volume2 size={18} />
                    <span><strong>{t(snapshot.voicePhase === 'listening' || snapshot.voicePhase === 'transcribing'
                      ? 'dynamicIsland.processingVoice'
                      : 'dynamicIsland.speakingReply')}</strong><small>{snapshot.voiceQueueLength > 0
                        ? t('dynamicIsland.sentencesQueued', { count: snapshot.voiceQueueLength })
                        : t('dynamicIsland.interruptAnytime')}</small></span>
                  </div>
                ) : (
                  <div className="junqi-island-empty">
                    <Bot size={18} />
                    <span><strong>{t('dynamicIsland.noActiveTasks')}</strong><small>{t('dynamicIsland.activityHint')}</small></span>
                  </div>
                )}
              </div>

              <footer className="junqi-island-controls">
                <button type="button" onClick={() => action({ type: 'open-session', sessionKey: primarySessionActivity?.sessionKey || snapshot.sessionKey })} title={t('dynamicIsland.returnToChat')}><MessageCircle size={16} /><span>{t('dynamicIsland.chat')}</span></button>
                <button type="button" className={snapshot.pomodoro.running ? 'is-active' : ''} onClick={() => action({ type: 'pomodoro-toggle' })} title={t('dynamicIsland.focusTimer')}>
                  {snapshot.pomodoro.running && !snapshot.pomodoro.paused ? <Pause size={15} /> : <Play size={15} />}
                  <span>{remaining || t('dynamicIsland.focus')}</span>
                </button>
                {snapshot.pomodoro.running && (
                  <button type="button" onClick={() => action({ type: 'pomodoro-stop' })} title={t('dynamicIsland.stopTimer')}><Square size={14} /><span>{t('dynamicIsland.stop')}</span></button>
                )}
                {(outputVoiceActive || inputVoiceActive) && (
                  <button type="button" className="is-active" onClick={() => action({ type: 'voice-stop' })} title={t('dynamicIsland.stopVoice')}><Square size={14} /><span>{t('dynamicIsland.stopVoice')}</span></button>
                )}
                <button type="button" className={snapshot.dndMode ? 'is-active' : ''} onClick={() => action({ type: 'toggle-dnd' })} title={t('dynamicIsland.doNotDisturb')}>
                  {snapshot.dndMode ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  <span>{t(snapshot.dndMode ? 'dynamicIsland.muted' : 'dynamicIsland.alerts')}</span>
                </button>
              </footer>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
