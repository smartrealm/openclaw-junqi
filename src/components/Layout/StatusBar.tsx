// StatusBar — 底部状态栏（参照 Hermes AppStatusBar）
import { RotateCcw, HardDrive, Zap, Moon, Sun, PawPrint, Timer, Play, Pause, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBootSequenceStore, getBootProgressSummary } from '@/stores/bootSequenceStore';
import { usePetStore } from '@/stores/petStore';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { useSetupProgress } from '@/hooks/useSetupProgress';
import clsx from 'clsx';
import { Badge, StatusDot } from '@/components/shared/badge';
import { GatewaySelfRescuePanel } from '@/components/GatewaySelfRescuePanel';
import type { AegisTheme } from '@/theme/types';

const THEME_CYCLE: AegisTheme[] = ['aegis-dark', 'aegis-light', 'aegis-eyecare', 'aegis-midnight'];

function nextTheme(current: AegisTheme): AegisTheme {
  const idx = THEME_CYCLE.indexOf(current);
  if (idx < 0) return 'aegis-dark';
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}

export function StatusBar() {
  const { t } = useTranslation();
  const connected = useChatStore((st) => st.connected);
  const currentModel = useChatStore((st) => st.currentModel);
  const tokenUsage = useChatStore((st) => st.tokenUsage);
  const sessions = useChatStore((st) => st.sessions);
  const uiScale = useSettingsStore((st) => st.uiScale);
  const theme = useSettingsStore((st) => st.theme);
  const setTheme = useSettingsStore((st) => st.setTheme);
  const petEnabled = usePetStore((st) => st.enabled);
  const setPetEnabled = usePetStore((st) => st.setEnabled);
  const pomoEnabled = usePetStore((st) => st.pomodoro.enabled);
  const pomoRunning = usePetStore((st) => st.pomodoro.running);
  const pomoPaused = usePetStore((st) => st.pomodoro.paused);
  const pomoPhase = usePetStore((st) => st.pomodoro.phase);
  const setPomodoro = usePetStore((st) => st.setPomodoro);
  const gatewayUrl = useSettingsStore((st) => (st as any).gatewayUrl);
  const bootStages = useBootSequenceStore((st) => (st as any).stages);

  const modelLabel = (currentModel || '').split('/').pop() || '';
  const ctxPct = tokenUsage?.percentage ?? 0;
  const runningCount = useMemo(() => sessions.filter((sx) => sx.running).length, [sessions]);
  const totalTokens = useMemo(() => sessions.reduce((s, sx) => s + (sx.totalTokens ?? 0), 0), [sessions]);

  const port = useMemo(() => {
    const m = String(gatewayUrl || '').match(/:(\d+)/);
    return m ? m[1] : '18789';
  }, [gatewayUrl]);

  const bootSummary = useMemo(() => getBootProgressSummary(bootStages ?? {}), [bootStages]);
  const isBooting = (bootSummary?.completed ?? 0) < (bootSummary?.total ?? 0) && (bootSummary?.active?.status === 'running' || bootSummary?.active?.status === 'pending');
  const bootPct = bootSummary?.total ? Math.round((bootSummary.completed / bootSummary.total) * 100) : 0;

  // ── Inline restart status ────────────────────────────────────────
  // One hook consumes both producers (Rust setup-progress + App's
  // aegis:gateway-progress window events). We only care about step="gateway"
  // — install steps have their own progress surface in the Setup page.
  const [reconnecting, setReconnecting] = useState(false);
  const [gatewayPanelOpen, setGatewayPanelOpen] = useState(false);
  const gatewayPanelRef = useRef<HTMLDivElement>(null);
  const gatewayButtonRef = useRef<HTMLButtonElement>(null);
  const gatewayProgress = useSetupProgress('gateway');
  const showGatewayProgress = !!gatewayProgress && (!connected || reconnecting);
  const gatewayMsg = showGatewayProgress ? gatewayProgress?.message ?? null : null;
  const gatewayProg = showGatewayProgress ? gatewayProgress?.progress ?? null : null;

  useEffect(() => {
    if (!gatewayPanelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (gatewayPanelRef.current?.contains(target) || gatewayButtonRef.current?.contains(target)) return;
      setGatewayPanelOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [gatewayPanelOpen]);

  useEffect(() => {
    if (connected && !gatewayMsg) setReconnecting(false);
  }, [connected, gatewayMsg]);

  const handleRestart = () => {
    if (reconnecting) return;
    setReconnecting(true);
    // 1. Disconnect WS + reset state.
    try { gatewayManager.reset(); } catch {}
    // 2. Dispatch a global event so App.tsx picks this up and runs the full
    //    restart pipeline. App.tsx also emits aegis:gateway-progress so the
    //    inline status message + spinner update via useSetupProgress.
    window.dispatchEvent(new CustomEvent('aegis:manual-reconnect', {
      detail: { action: connected ? 'restart' : 'reconnect' },
    }));
    // 3. Self-clear if no progress event arrives within 5s (safety net).
    setTimeout(() => setReconnecting(false), 5_000);
  };

  const reconnectBusy = isBooting || reconnecting || !!gatewayMsg;
  const reconnectPct = gatewayProg != null
    ? Math.round(Math.max(0, Math.min(1, gatewayProg)) * 100)
    : (reconnecting ? null : 0);
  const gatewayActionLabel = connected
    ? t('statusBar.restartGateway', '重启 Gateway')
    : t('statusBar.reconnect', '重新连接');
  const gatewayPanelTitle = connected
    ? t('statusBar.gatewayPanelRestartHint', '重启会重新拉起本地 Gateway，并刷新模型、会话和运行时状态。')
    : t('statusBar.gatewayPanelReconnectHint', '重新连接会先检测本地 Gateway，必要时自动启动或重启。');

  const resolvedTheme: AegisTheme = theme.startsWith('aegis-') ? (theme as AegisTheme) : 'aegis-dark';
  const isDarkish = resolvedTheme === 'aegis-dark' || resolvedTheme === 'aegis-midnight';
  const themeLabel = t(`theme.${resolvedTheme.replace('aegis-', '')}`, resolvedTheme.replace('aegis-', ''));

  const handleThemeCycle = () => {
    const next = nextTheme(resolvedTheme);
    setTheme(next);
  };

  return (
    <footer className="flex items-center gap-0 h-[26px] min-w-0 border-t border-aegis-border bg-aegis-surface text-[11px] shrink-0 select-none overflow-hidden whitespace-nowrap" role="status">
      {/* 网关状态与操作：左下角需要像控制入口，而不是普通状态文字。 */}
      <div className="flex h-full items-center border-r border-aegis-border/50">
        <button
          ref={gatewayButtonRef}
          onClick={() => setGatewayPanelOpen((open) => !open)}
          className={clsx(
            'flex h-full items-center gap-1.5 px-2.5 transition-colors',
            gatewayPanelOpen
              ? 'bg-aegis-hover/40 text-aegis-text'
              : 'text-aegis-text-secondary hover:bg-aegis-hover/30 hover:text-aegis-text',
          )}
          title={t('statusBar.gatewayPanelTitle', 'Gateway 控制')}
          aria-label={t('statusBar.gatewayPanelTitle', 'Gateway 控制')}
        >
          <StatusDot tone={connected ? 'ok' : reconnectBusy ? 'warn' : 'err'} size="sm" live={connected || reconnectBusy} />
          <span className="font-medium">{t('statusBar.gateway', '网关')}</span>
          <span className="font-mono text-aegis-text">:{port}</span>
          <ChevronUp size={10} className={clsx('transition-transform', !gatewayPanelOpen && 'rotate-180')} />
        </button>

        <button
          onClick={() => void handleRestart()}
          disabled={reconnectBusy}
          className={clsx(
            'flex h-full items-center gap-1.5 px-2.5 border-l border-aegis-border/50 font-medium transition-colors',
            reconnectBusy
              ? 'text-aegis-warning bg-aegis-warning/5'
              : connected
                ? 'text-aegis-text-secondary hover:text-aegis-primary hover:bg-aegis-primary/8'
                : 'text-aegis-warning hover:bg-aegis-warning/8',
            reconnectBusy && 'animate-pulse',
          )}
          title={gatewayMsg || gatewayPanelTitle}
          aria-label={gatewayActionLabel}
        >
          <RotateCcw size={11} className={reconnectBusy ? 'animate-spin' : ''} />
          <span>
            {gatewayMsg
              ? (reconnectPct != null ? `${reconnectPct}%` : t('statusBar.gatewayBusy', '处理中'))
              : (isBooting ? `${bootPct}%` : gatewayActionLabel)}
          </span>
        </button>
      </div>

      {gatewayPanelOpen && createPortal(
        <div
          ref={gatewayPanelRef}
          className="fixed left-2 bottom-[30px] z-[2147482000] w-[380px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-48px)] overflow-y-auto rounded-xl bg-aegis-menu-bg shadow-[0_12px_36px_rgba(0,0,0,0.42)]"
        >
          <GatewaySelfRescuePanel
            variant="popover"
            connected={connected}
            busy={reconnectBusy}
            port={port}
            progressMessage={gatewayMsg || gatewayPanelTitle}
            progressPercent={reconnectPct ?? bootPct ?? null}
            primaryActionLabel={gatewayActionLabel}
            onPrimaryAction={() => void handleRestart()}
            error={gatewayMsg || gatewayPanelTitle}
          />
        </div>,
        document.body,
      )}

      {/* 重连步骤详情（与 install 步骤 statusMessage 同一信息源） */}
      {gatewayMsg && (
        <span
          className="flex items-center gap-1.5 px-2.5 h-full border-r border-aegis-border/50 text-aegis-warning/90 max-w-[280px]"
          title={gatewayMsg}
        >
          <span className="truncate text-[10.5px]">{gatewayMsg}</span>
        </span>
      )}

      {/* 模型 */}
      {modelLabel && (
        <span className="flex items-center gap-1 px-3 h-full border-r border-aegis-border/50 text-aegis-text-dim">
          模型 <span className="text-aegis-text-secondary">{modelLabel}</span>
        </span>
      )}

      {/* 上下文 */}
      {ctxPct > 0 && (
        <span className="flex items-center gap-1 px-3 h-full border-r border-aegis-border/50 text-aegis-text-dim">
          <HardDrive size={11} className="opacity-40" /> <span className="text-aegis-text-secondary">{ctxPct}%</span>
        </span>
      )}

      {/* 运行 */}
      {runningCount > 0 && (
        <span className="flex items-center gap-1.5 px-3 h-full border-r border-aegis-border/50 text-aegis-text-dim">
          <StatusDot tone="running" size="sm" live />
          <Badge tone="running" size="sm" variant="soft">{runningCount} 运行</Badge>
        </span>
      )}

      {/* Token */}
      {totalTokens > 0 && (
        <span className="flex items-center gap-1 px-3 h-full border-r border-aegis-border/50 text-aegis-text-dim">
          <Zap size={11} className="opacity-40" /> <span className="text-aegis-text-secondary">{fmtTokens(totalTokens)} tok</span>
        </span>
      )}

      <span className="min-w-0 shrink" />

      {uiScale && uiScale !== 100 && <span className="px-2 text-aegis-text-dim opacity-50 font-mono text-[10px]">{uiScale}%</span>}

      {/* ── Bottom-right cluster: theme cycle | pet toggle | pomodoro toggle ── */}
      {/* Each button shows a single semantic icon + a short label so the
       *  control is self-describing without relying on hover tooltips.
       *  The pet/pomodoro buttons reflect state via color (primary when on,
       *  warning when running, dim when off). */}
      <button
        onClick={handleThemeCycle}
        title={t('theme.cycle', 'Cycle theme') + `: ${themeLabel}`}
        aria-label={t('theme.cycle', 'Cycle theme')}
        className="flex items-center gap-1.5 px-2 h-full border-l border-aegis-border/50 text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30 transition-colors"
      >
        {isDarkish ? <Moon size={11} /> : <Sun size={11} />}
        <span className="text-[10.5px]">{themeLabel}</span>
      </button>

      <button
        onClick={() => setPetEnabled(!petEnabled)}
        title={petEnabled ? t('statusBar.petOnTip', '点击关闭桌面宠物') : t('statusBar.petOffTip', '点击开启桌面宠物')}
        aria-label={t('statusBar.petToggle', 'Toggle pet')}
        className={clsx(
          'flex items-center gap-1.5 px-2 h-full border-l border-aegis-border/50 transition-colors',
          petEnabled
            ? 'text-aegis-primary hover:bg-aegis-hover/30'
            : 'text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30',
        )}
      >
        <PawPrint size={11} />
        <span className="text-[10.5px]">
          {petEnabled ? t('statusBar.petOn', '宠物') : t('statusBar.petOff', '隐藏')}
        </span>
      </button>

      {pomoEnabled ? (
        pomoRunning ? (
          <button
            onClick={() => togglePausePomodoro()}
            title={pomoPaused ? t('statusBar.pomoResume', '继续') : t('statusBar.pomoPause', '暂停')}
            aria-label={t('statusBar.pomoToggle', 'Toggle pomodoro')}
            className={clsx(
              'flex items-center gap-1.5 px-2 h-full border-l border-aegis-border/50 transition-colors',
              pomoPaused
                ? 'text-aegis-text-secondary hover:bg-aegis-hover/30'
                : 'text-aegis-warning hover:bg-aegis-hover/30',
            )}
          >
            {pomoPaused ? <Play size={11} /> : <Pause size={11} />}
            <span className="text-[10.5px] font-mono tabular-nums">
              {t('statusBar.pomo', '番茄')}
              {pomoPhase === 'work' ? ' · 专注' : pomoPhase === 'break' ? ' · 休息' : ''}
            </span>
          </button>
        ) : (
          <button
            onClick={() => startPomodoro()}
            title={t('statusBar.pomoStart', '开始番茄')}
            aria-label={t('statusBar.pomoStart', '开始番茄')}
            className="flex items-center gap-1.5 px-2 h-full border-l border-aegis-border/50 text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30 transition-colors"
          >
            <Timer size={11} />
            <span className="text-[10.5px]">{t('statusBar.pomoStartShort', '番茄')}</span>
          </button>
        )
      ) : (
        <button
          onClick={() => setPomodoro({ enabled: true })}
          title={t('statusBar.togglePomodoro', '开启番茄钟')}
          aria-label={t('statusBar.togglePomodoro', '开启番茄钟')}
          className="flex items-center gap-1.5 px-2 h-full border-l border-aegis-border/50 text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30 transition-colors"
        >
          <Timer size={11} />
          <span className="text-[10.5px]">{t('statusBar.togglePomodoroShort', '番茄')}</span>
        </button>
      )}

      <span className="px-3 text-aegis-text-dim opacity-40 font-mono text-[10px] border-l border-aegis-border/50">v0.5.0</span>
    </footer>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
