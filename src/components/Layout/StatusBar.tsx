// StatusBar — 底部状态栏（参照 Hermes AppStatusBar）
import { Wifi, WifiOff, RotateCcw, HardDrive, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBootSequenceStore, getBootProgressSummary } from '@/stores/bootSequenceStore';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import clsx from 'clsx';
import { Badge, StatusDot } from '@/components/shared/badge';

export function StatusBar() {
  const { t } = useTranslation();
  const connected = useChatStore((st) => st.connected);
  const currentModel = useChatStore((st) => st.currentModel);
  const tokenUsage = useChatStore((st) => st.tokenUsage);
  const sessions = useChatStore((st) => st.sessions);
  const uiScale = useSettingsStore((st) => st.uiScale);
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

  const handleRestart = () => {
    // Reconnect the WebSocket; if the gateway process itself is down, retry it.
    try { gatewayManager.reset(); } catch {}
    try { void window.aegis?.gateway?.retry?.(); } catch {}
  };

  return (
    <footer className="flex items-center gap-0 h-[26px] min-w-0 border-t border-aegis-border bg-aegis-surface text-[11px] shrink-0 select-none overflow-hidden whitespace-nowrap" role="status">
      {/* 网关 + 端口 */}
      <span className="flex items-center gap-1.5 px-3 h-full border-r border-aegis-border/50">
        <StatusDot tone={connected ? 'ok' : 'err'} size="sm" live={connected} />
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
      <span className="px-3 text-aegis-text-dim opacity-40 font-mono text-[10px]">v0.5.0</span>
    </footer>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
