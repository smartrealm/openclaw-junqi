// StatusBar — 底部状态栏（参照 Hermes AppStatusBar）
import { Wifi, WifiOff, RotateCcw, HardDrive, Zap, Palette, PawPrint, Timer, Play, Pause, Square } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePetStore } from '@/stores/petStore';
import { useBootSequenceStore, getBootProgressSummary } from '@/stores/bootSequenceStore';
import { AEGIS_THEMES, isAegisTheme } from '@/theme/types';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import clsx from 'clsx';

export function StatusBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connected = useChatStore((st) => st.connected);
  const currentModel = useChatStore((st) => st.currentModel);
  const tokenUsage = useChatStore((st) => st.tokenUsage);
  const sessions = useChatStore((st) => st.sessions);
  const uiScale = useSettingsStore((st) => st.uiScale);
  const theme = useSettingsStore((st) => (st as any).theme);
  const setTheme = useSettingsStore((st) => (st as any).setTheme);
  const gatewayUrl = useSettingsStore((st) => (st as any).gatewayUrl);
  const petEnabled = usePetStore((st) => (st as any).enabled);
  const setPetEnabled = usePetStore((st) => (st as any).setEnabled);
  const pomoEnabled = usePetStore((st) => (st as any).pomodoro.enabled);
  const pomoRunning = usePetStore((st) => (st as any).pomodoro.running);
  const pomoPaused = usePetStore((st) => (st as any).pomodoro.paused);
  const pomoPhase = usePetStore((st) => (st as any).pomodoro.phase);
  const setPomodoro = usePetStore((st) => (st as any).setPomodoro);
  const bootStages = useBootSequenceStore((st) => (st as any).stages);

  const modelLabel = (currentModel || '').split('/').pop() || '';
  const ctxPct = tokenUsage?.percentage ?? 0;
  const runningCount = useMemo(() => sessions.filter((sx) => sx.running).length, [sessions]);
  const totalTokens = useMemo(() => sessions.reduce((s, sx) => s + (sx.totalTokens ?? 0), 0), [sessions]);

  const port = useMemo(() => {
    const m = String(gatewayUrl || '').match(/:(\d+)/);
    return m ? m[1] : '—';
  }, [gatewayUrl]);

  const bootSummary = useMemo(() => getBootProgressSummary(bootStages ?? {}), [bootStages]);
  const isBooting = (bootSummary?.completed ?? 0) < (bootSummary?.total ?? 0) && (bootSummary?.active?.status === 'running' || bootSummary?.active?.status === 'pending');
  const bootPct = bootSummary?.total ? Math.round((bootSummary.completed / bootSummary.total) * 100) : 0;

  const handleRestart = () => {
    window.dispatchEvent(new Event('aegis:reconnect'));
  };

  const cycleTheme = () => {
    const current = isAegisTheme(theme) ? theme : 'aegis-dark';
    const idx = AEGIS_THEMES.indexOf(current);
    setTheme(AEGIS_THEMES[(idx + 1) % AEGIS_THEMES.length]);
  };

  return (
    <footer className="flex items-center gap-0 h-[26px] min-w-0 border-t border-aegis-border bg-aegis-surface text-[11px] shrink-0 select-none overflow-hidden whitespace-nowrap" role="status">
      {/* 网关 + 端口 */}
      <span className="flex items-center gap-1.5 px-3 h-full border-r border-aegis-border/50">
        <span className="w-[5px] h-[5px] rounded-full" style={{ background: connected ? 'var(--aegis-success)' : 'var(--aegis-danger)' }} />
        <span className="text-aegis-text-secondary">{t('statusBar.gateway', '网关')}</span>
        <span className="text-aegis-text font-mono">:{port}</span>
      </span>

      {/* 重连按钮（带进度） */}
      <button onClick={handleRestart} disabled={isBooting}
        className={clsx('flex items-center gap-1 px-2 h-full border-r border-aegis-border/50 transition-colors',
          isBooting
            ? 'text-aegis-warning'
            : 'text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30',
          isBooting && 'animate-pulse')}
        title={isBooting ? `${t('statusBar.reconnecting', '重连中')} ${bootPct}%` : t('statusBar.reconnect', '重连')}>
        <RotateCcw size={10} className={isBooting ? 'animate-spin' : ''} />
        <span>{isBooting ? `${bootPct}%` : t('statusBar.reconnect', '重连')}</span>
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
        <span className="flex items-center gap-1 px-3 h-full border-r border-aegis-border/50 text-aegis-text-dim">
          <span className="w-[5px] h-[5px] rounded-full bg-aegis-success shadow-[0_0_0_2px_rgb(61_214_140/0.18)]" />
          <span className="text-aegis-text-secondary">{runningCount} 运行</span>
        </span>
      )}

      {/* Token */}
      {totalTokens > 0 && (
        <span className="flex items-center gap-1 px-3 h-full border-r border-aegis-border/50 text-aegis-text-dim">
          <Zap size={11} className="opacity-40" /> <span className="text-aegis-text-secondary">{fmtTokens(totalTokens)} tok</span>
        </span>
      )}

      <span className="min-w-0 shrink" />

      {/* 番茄钟 */}
      {pomoEnabled ? (
        pomoRunning ? (
          <button onClick={togglePausePomodoro}
            className="flex items-center gap-1 px-2 h-full border-l border-aegis-border/50 text-aegis-warning hover:bg-aegis-hover/30 transition-colors"
            title={pomoPaused ? t('statusBar.pomoResume', '继续') : t('statusBar.pomoPause', '暂停')}>
            {pomoPaused ? <Play size={10} /> : <Pause size={10} />}
            <span>{pomoPhase === 'work' ? t('statusBar.work', '工作') : t('statusBar.break', '休息')}</span>
          </button>
        ) : (
          <button onClick={startPomodoro}
            className="flex items-center gap-1 px-2 h-full border-l border-aegis-border/50 text-aegis-text-dim hover:text-aegis-warning hover:bg-aegis-hover/30 transition-colors"
            title={t('statusBar.pomoStart', '开始番茄')}>
            <Play size={10} />
            <span>{t('statusBar.pomoStart', '开始')}</span>
          </button>
        )
      ) : (
        <button onClick={() => setPomodoro({ enabled: true })}
          className="flex items-center gap-1 px-2 h-full border-l border-aegis-border/50 text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30 transition-colors"
          title={t('statusBar.togglePomodoro', '开启番茄钟')}>
          <Timer size={10} />
          <span>{t('statusBar.pomoOff', '番茄')}</span>
        </button>
      )}

      {/* 萌宠 — 点击跳转到宠物设置 */}
      <button onClick={() => navigate('/settings')}
        className={clsx('flex items-center gap-1 px-2 h-full border-l border-aegis-border/50 transition-colors',
          petEnabled ? 'text-aegis-primary' : 'text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30')}
        title={t('statusBar.togglePet', '宠物设置')}>
        <PawPrint size={10} />
        <span>{petEnabled ? t('statusBar.petOn', '萌宠开') : t('statusBar.petOff', '萌宠关')}</span>
      </button>

      {/* 主题切换 */}
      <button onClick={cycleTheme}
        className="flex items-center gap-1 px-2 h-full border-l border-aegis-border/50 text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/30 transition-colors"
        title={t('statusBar.switchTheme', '切换主题')}>
        <Palette size={10} />
        <span>{t('statusBar.theme', '切换')}</span>
      </button>

      {uiScale && uiScale !== 100 && <span className="px-2 text-aegis-text-dim opacity-50 font-mono text-[10px]">{uiScale}%</span>}
      <span className="px-3 text-aegis-text-dim opacity-40 font-mono text-[10px]">v0.5.0</span>
    </footer>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
