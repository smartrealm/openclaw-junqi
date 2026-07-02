// StatusBar — 底部状态栏（参照 Hermes AppStatusBar）
import { Wifi, WifiOff, RotateCcw, HardDrive, Zap, Moon, Sun, PawPrint, Timer, Play, Pause } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBootSequenceStore, getBootProgressSummary } from '@/stores/bootSequenceStore';
import { usePetStore } from '@/stores/petStore';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { applyTheme } from '@/theme/apply';
import clsx from 'clsx';
import { Badge, StatusDot } from '@/components/shared/badge';
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

  const [reconnecting, setReconnecting] = useState(false);
  const handleRestart = () => {
    if (reconnecting) return;
    setReconnecting(true);
    // 1. Disconnect WS + reset state.
    try { gatewayManager.reset(); } catch {}
    // 2. Dispatch a global event so App.tsx's triggerGatewayReconnect
    //    callback picks this up and runs the full restart pipeline
    //    (ensure_gateway_running → wait → reconnect WS). This keeps the
    //    reconnect logic in ONE place (App.tsx) rather than duplicating
    //    it here. StatusBar should not know how to reconnect — it just
    //    signals the intent.
    window.dispatchEvent(new CustomEvent('aegis:manual-reconnect'));
    // 3. Spinner runs for at most 5s then self-clears.
    setTimeout(() => setReconnecting(false), 5_000);
  };

  const resolvedTheme: AegisTheme = theme.startsWith('aegis-') ? (theme as AegisTheme) : 'aegis-dark';
  const isDarkish = resolvedTheme === 'aegis-dark' || resolvedTheme === 'aegis-midnight';
  const themeLabel = t(`theme.${resolvedTheme.replace('aegis-', '')}`, resolvedTheme.replace('aegis-', ''));

  const handleThemeCycle = () => {
    const next = nextTheme(resolvedTheme);
    applyTheme(next);
    setTheme(next);
  };

  return (
    <footer className="flex items-center gap-0 h-[26px] min-w-0 border-t border-aegis-border bg-aegis-surface text-[11px] shrink-0 select-none overflow-hidden whitespace-nowrap" role="status">
      {/* 网关 + 端口 */}
      <span className="flex items-center gap-1.5 px-3 h-full border-r border-aegis-border/50">
        <StatusDot tone={connected ? 'ok' : 'err'} size="sm" live={connected} />
        <span className="text-aegis-text-secondary">{t('statusBar.gateway', '网关')}</span>
        <span className="text-aegis-text font-mono">:{port}</span>
      </span>

      {/* 重连按钮（带进度 / 自旋 / 本地 loading 状态） */}
      <button onClick={() => void handleRestart()} disabled={isBooting || reconnecting}
        className={clsx('flex items-center gap-1 px-2 h-full border-r border-aegis-border/50 transition-colors',
          isBooting || reconnecting
            ? 'text-aegis-warning'
            : 'text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30',
          (isBooting || reconnecting) && 'animate-pulse')}
        title={isBooting ? `${t('statusBar.reconnecting', '重连中')} ${bootPct}%` : reconnecting ? t('statusBar.reconnecting', '重连中...') : t('statusBar.reconnect', '重连')}>
        <RotateCcw size={10} className={isBooting || reconnecting ? 'animate-spin' : ''} />
        <span>{isBooting ? `${bootPct}%` : reconnecting ? '…' : t('statusBar.reconnect', '重连')}</span>
      </button>

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
