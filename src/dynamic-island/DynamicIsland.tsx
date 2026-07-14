import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Bot,
  Check,
  ChevronUp,
  CircleAlert,
  Clock3,
  FileCheck2,
  Files,
  MessageCircle,
  Pause,
  Play,
  Radio,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { combineUnlisteners, emitTauriEvent, subscribeTauriEvent } from '@/utils/tauriEvents';
import {
  EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
  formatRemainingTime,
  shouldPeekForSnapshot,
  type DynamicIslandSnapshot,
  type DynamicIslandTask,
} from './model';
import './dynamic-island.css';

type IslandAction =
  | { type: 'open-task'; taskId: string }
  | { type: 'quick-chat' }
  | { type: 'toggle-dnd' }
  | { type: 'pomodoro-toggle' }
  | { type: 'pomodoro-stop' }
  | { type: 'hide' };

const COLLAPSE_DELAY_MS = 5_200;
const HOVER_EXPAND_DELAY_MS = 140;
const HOVER_COLLAPSE_DELAY_MS = 280;

function statusTone(status: DynamicIslandTask['status']) {
  if (status === 'input_required' || status === 'awaiting_review') return 'attention';
  if (status === 'failed' || status === 'interrupted') return 'error';
  if (status === 'done') return 'success';
  return 'running';
}

function statusLabel(status: DynamicIslandTask['status'], chinese: boolean) {
  const labels: Record<DynamicIslandTask['status'], [string, string]> = {
    todo: ['待办', 'Todo'],
    pending: ['排队中', 'Pending'],
    running: ['执行中', 'Running'],
    input_required: ['等待输入', 'Needs input'],
    awaiting_review: ['等待审阅', 'Needs review'],
    detached: ['已分离', 'Detached'],
    interrupted: ['已中断', 'Interrupted'],
    done: ['已完成', 'Done'],
    failed: ['失败', 'Failed'],
    cancelled: ['已取消', 'Cancelled'],
  };
  return labels[status][chinese ? 0 : 1];
}

function StatusGlyph({ task }: { task: DynamicIslandTask }) {
  const tone = statusTone(task.status);
  if (tone === 'success') return <Check size={13} strokeWidth={2.4} />;
  if (tone === 'attention' || tone === 'error') return <CircleAlert size={13} strokeWidth={2.2} />;
  return <span className="junqi-island-spinner" aria-hidden="true" />;
}

export default function DynamicIsland() {
  const [snapshot, setSnapshot] = useState(EMPTY_DYNAMIC_ISLAND_SNAPSHOT);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const previousSnapshotRef = useRef<DynamicIslandSnapshot | null>(null);
  const autoCollapseTimerRef = useRef<number | null>(null);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverCollapseTimerRef = useRef<number | null>(null);
  const chinese = navigator.language.toLowerCase().startsWith('zh');

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
    void emitTauriEvent('dynamic-island:ready');

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
        void emitTauriEvent('dynamic-island:ready');
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
    if (!snapshot.pomodoro.running || snapshot.pomodoro.paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.pomodoro.paused, snapshot.pomodoro.running]);

  const action = useCallback((payload: IslandAction) => {
    void emitTauriEvent('dynamic-island:action', payload).catch(() => undefined);
  }, []);

  const runningCount = snapshot.tasks.filter((task) => task.status === 'running').length;
  const attentionTasks = snapshot.tasks.filter((task) => (
    task.status === 'input_required' || task.status === 'awaiting_review' || task.status === 'failed'
  ));
  const attentionCount = attentionTasks.length;
  const primaryRunningTask = snapshot.tasks.find((task) => task.status === 'running');
  const remaining = formatRemainingTime(snapshot, now);
  const headline = useMemo(() => {
    if (snapshot.resourceDrop?.phase === 'dragging') {
      return chinese ? `准备接收 ${snapshot.resourceDrop.count} 个文件` : `Ready for ${snapshot.resourceDrop.count} files`;
    }
    if (snapshot.resourceDrop?.phase === 'received') {
      return chinese ? '文件已送往快捷对话' : 'Files sent to Quick Chat';
    }
    if (snapshot.notice) return snapshot.notice.title;
    if (attentionCount === 1) return attentionTasks[0].title;
    if (attentionCount > 0) return chinese ? `${attentionCount} 项需要处理` : `${attentionCount} need attention`;
    if (runningCount === 1 && primaryRunningTask) return primaryRunningTask.title;
    if (runningCount > 0) return chinese ? `${runningCount} 个 Agent 执行中` : `${runningCount} agents running`;
    if (snapshot.sessionRunning) return chinese ? '当前会话正在回复' : 'The active session is responding';
    return snapshot.connected
      ? (chinese ? 'JunQi 已就绪' : 'JunQi is ready')
      : snapshot.connecting
        ? (chinese ? '正在连接 Gateway' : 'Connecting to Gateway')
        : (chinese ? 'Gateway 离线' : 'Gateway offline');
  }, [attentionCount, attentionTasks, chinese, primaryRunningTask, runningCount, snapshot.connected, snapshot.connecting, snapshot.notice, snapshot.resourceDrop, snapshot.sessionRunning]);
  const compactMeta = useMemo(() => {
    const task = attentionTasks[0] ?? primaryRunningTask;
    if (task) return `${task.agent} · ${statusLabel(task.status, chinese)}`;
    if (snapshot.pomodoro.running) {
      return snapshot.pomodoro.phase === 'work'
        ? (chinese ? '专注计时' : 'Focus session')
        : (chinese ? '休息计时' : 'Break session');
    }
    if (snapshot.sessionRunning) return chinese ? 'OPENCLAW · 生成中' : 'OPENCLAW · RESPONDING';
    return snapshot.connected ? 'OPENCLAW ONLINE' : 'OPENCLAW STANDBY';
  }, [attentionTasks, chinese, primaryRunningTask, snapshot.connected, snapshot.pomodoro.phase, snapshot.pomodoro.running, snapshot.sessionRunning]);

  return (
    <main
      className={`junqi-island-shell ${expanded ? 'is-expanded' : 'is-compact'}`}
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
            aria-label={chinese ? '展开 JunQi 灵动岛' : 'Expand JunQi Dynamic Island'}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={`junqi-island-orb ${attentionCount > 0 ? 'is-attention' : ''}`}>
              <img src="/src/assets/brand/junqi-emblem.svg" alt="" />
            </span>
            <span className="junqi-island-compact-copy">
              <strong>{headline}</strong>
              <small>{compactMeta}</small>
            </span>
            <span className="junqi-island-compact-metrics">
              {remaining ? (
                <span className="junqi-island-timer"><Clock3 size={12} />{remaining}</span>
              ) : runningCount > 0 ? (
                <span className="junqi-island-running"><span className="junqi-island-spinner" />{runningCount}</span>
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
                  ? (snapshot.resourceDrop.phase === 'dragging'
                    ? (chinese ? '松开鼠标，交给 JunQi 分析' : 'Release to let JunQi analyze them')
                    : (chinese ? '快捷对话已准备好文件上下文' : 'Quick Chat has the file context'))
                  : snapshot.notice?.body || (chinese ? '智能体运行中心' : 'Agent activity center')}</small></span>
              </div>
              <div className="junqi-island-window-actions">
                <button type="button" onClick={() => setIslandExpanded(false)} title={chinese ? '收起' : 'Collapse'}><ChevronUp size={15} /></button>
                <button type="button" onClick={() => action({ type: 'hide' })} title={chinese ? '关闭灵动岛' : 'Hide Dynamic Island'}><X size={15} /></button>
              </div>
            </header>

            <div className="junqi-island-content">
              <div className="junqi-island-task-list" aria-label={chinese ? 'Agent 状态' : 'Agent status'}>
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
                        ? snapshot.petEnabled
                          ? (chinese ? '萌宠正在接应' : 'Your pet is receiving')
                          : (chinese ? '文件正在接入' : 'Receiving files')
                        : (chinese ? '接收完成' : 'Transfer complete')}</strong>
                      <small>{snapshot.resourceDrop.labels.join(' · ') || (chinese ? '文件资源' : 'File resources')}</small>
                    </div>
                    <div className="junqi-island-drop-progress"><span /></div>
                  </div>
                ) : snapshot.tasks.length > 0 ? snapshot.tasks.slice(0, 3).map((task) => (
                  <button key={task.id} type="button" className="junqi-island-task" onClick={() => action({ type: 'open-task', taskId: task.id })}>
                    <span className={`junqi-island-task-icon is-${statusTone(task.status)}`}><StatusGlyph task={task} /></span>
                    <span className="junqi-island-task-copy"><strong>{task.title}</strong><small>{task.agent} · {statusLabel(task.status, chinese)}</small></span>
                    <ChevronUp size={13} className="junqi-island-task-open" />
                  </button>
                )) : (
                  <div className="junqi-island-empty">
                    <Bot size={18} />
                    <span><strong>{chinese ? '没有运行中的任务' : 'No active tasks'}</strong><small>{chinese ? '需要时我会在这里提醒你' : 'Important activity will appear here'}</small></span>
                  </div>
                )}
              </div>

              <footer className="junqi-island-controls">
                <button type="button" onClick={() => action({ type: 'quick-chat' })} title={chinese ? '快捷对话' : 'Quick chat'}><MessageCircle size={16} /><span>{chinese ? '对话' : 'Chat'}</span></button>
                <button type="button" className={snapshot.pomodoro.running ? 'is-active' : ''} onClick={() => action({ type: 'pomodoro-toggle' })} title={chinese ? '专注计时' : 'Focus timer'}>
                  {snapshot.pomodoro.running && !snapshot.pomodoro.paused ? <Pause size={15} /> : <Play size={15} />}
                  <span>{remaining || (chinese ? '专注' : 'Focus')}</span>
                </button>
                {snapshot.pomodoro.running && (
                  <button type="button" onClick={() => action({ type: 'pomodoro-stop' })} title={chinese ? '停止计时' : 'Stop timer'}><Square size={14} /><span>{chinese ? '停止' : 'Stop'}</span></button>
                )}
                <button type="button" className={snapshot.dndMode ? 'is-active' : ''} onClick={() => action({ type: 'toggle-dnd' })} title={chinese ? '请勿打扰' : 'Do not disturb'}>
                  {snapshot.dndMode ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  <span>{snapshot.dndMode ? (chinese ? '静音' : 'Muted') : (chinese ? '通知' : 'Alerts')}</span>
                </button>
              </footer>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
