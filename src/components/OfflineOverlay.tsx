// ═══════════════════════════════════════════════════════════
// OfflineOverlay — Shown on pages that require Gateway connection
// Transparent overlay with centered status — no blocking, no errors
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, MonitorDot, WifiOff } from 'lucide-react';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { useSetupProgress } from '@/hooks/useSetupProgress';
import { GatewaySelfRescuePanel } from '@/components/GatewaySelfRescuePanel';

export function OfflineOverlay() {
  const { t } = useTranslation();
  const connecting = useChatStore((s) => s.connecting);
  const connected = useChatStore((s) => s.connected);
  const lastError = gateway.getLastError?.();
  const [restartInfo, setRestartInfo] = useState({ retrying: false, logs: [] as string[] });
  const [manualRecovery, setManualRecovery] = useState(false);
  const [openControlUiWhenReady, setOpenControlUiWhenReady] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);
  const gatewayProgress = useSetupProgress('gateway');
  const progressFailed = gatewayProgress?.status === 'failed';
  const progressCompleted = gatewayProgress?.status === 'completed';
  const recoveryBusy = !connected
    && !progressFailed
    && !progressCompleted
    && (manualRecovery
      || restartInfo.retrying
      || gatewayProgress?.status === 'running'
      || (Boolean(gatewayProgress) && gatewayProgress?.status === undefined));
  const isRecovering = connecting || recoveryBusy;
  const recoveryLogText = restartInfo.logs.slice(-12).join('\n');
  const fallbackProgress = connecting ? 0.58 : restartInfo.retrying ? 0.30 : manualRecovery ? 0.10 : 0;
  const progressValue = Math.round(Math.max(0, Math.min(1, gatewayProgress?.progress ?? fallbackProgress)) * 100);
  const progressMessage = gatewayProgress?.message
    ?? (connecting
      ? t('offline.connectingProgress', '正在建立与 Gateway 的连接…')
      : restartInfo.retrying
        ? t('gateway.progress.restart', '正在重启 OpenClaw Gateway…')
        : t('offline.checkingGateway', '正在检查 OpenClaw Gateway…'));
  const showProgress = isRecovering
    || Boolean(gatewayProgress)
    || manualRecovery;

  useEffect(() => gatewayManager.onStateChange((snap) => {
    const latest = [snap.logs?.stdout, snap.logs?.stderr].filter(Boolean).join('\n');
    setRestartInfo((prev) => ({
      retrying: snap.retrying,
      logs: latest ? latest.split('\n').filter(Boolean).slice(-80) : prev.logs,
    }));
  }), []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [restartInfo.logs]);

  useEffect(() => {
    if (connected || progressFailed || progressCompleted) {
      setManualRecovery(false);
    }
  }, [connected, progressCompleted, progressFailed]);

  const openLogsPage = () => {
    try { window.location.hash = '#/logs'; } catch {}
  };

  const copyRecoveryLogs = () => {
    if (!recoveryLogText || !navigator.clipboard) return;
    void navigator.clipboard.writeText(recoveryLogText).then(() => {
      setLogsCopied(true);
      window.setTimeout(() => setLogsCopied(false), 1_200);
    }).catch(() => {});
  };

  const requestRecovery = (
    source: 'offline' | 'control-ui',
    openControlUi = false,
    action: 'reconnect' | 'restart' = 'reconnect',
  ) => {
    if (recoveryBusy && !openControlUi) return;
    setManualRecovery(true);
    window.dispatchEvent(new CustomEvent('aegis:manual-reconnect', {
      detail: { action, source, openControlUi },
    }));
  };

  const openControlUi = async () => {
    if (!window.aegis?.consoleUi) return;

    // Control UI is a Gateway client. When it is unavailable, queue the
    // user's intent and reuse the one recovery pipeline instead of opening a
    // browser pointed at a dead localhost endpoint.
    if (!connected) {
      setOpenControlUiWhenReady(true);
      requestRecovery('control-ui', true);
      return;
    }

    const result = await window.aegis.consoleUi.open();
    if (!result.success) {
      setOpenControlUiWhenReady(true);
      requestRecovery('control-ui', true);
    }
  };

  useEffect(() => {
    if (connected) setOpenControlUiWhenReady(false);
  }, [connected]);

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-[680px] px-5 text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-5
          bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)]
          flex items-center justify-center">
          {isRecovering
            ? <Loader2 size={28} className="text-aegis-warning animate-spin" />
            : <WifiOff size={28} className="text-aegis-text-dim" />}
        </div>
        <h2 className="text-[16px] font-bold text-aegis-text mb-2">
          {isRecovering
            ? connecting ? t('offline.connectingTitle') : t('offline.recoveringTitle', '正在恢复 Gateway')
            : t('offline.title')}
        </h2>
        <p className="text-[12.5px] text-aegis-text-muted leading-relaxed mb-2">
          {isRecovering
            ? connecting ? t('offline.connectingDescription') : t('offline.recoveringDescription', '正在启动或重启 OpenClaw Gateway，并自动重新连接。')
            : t('offline.description')}
        </p>

        {isRecovering ? (
          <div className="flex items-center justify-center gap-2 text-[11px] text-aegis-text-dim mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-aegis-warning/60 animate-pulse" />
            {connecting ? t('offline.connectingHint') : progressMessage}
          </div>
        ) : lastError ? (
          <div className="mb-4 px-3 py-2 rounded-lg bg-aegis-error/10 border border-aegis-error/20 text-left">
            <p className="text-[10px] font-mono text-aegis-error/80 break-all leading-relaxed">
              {lastError}
            </p>
          </div>
        ) : null}

        {showProgress && (
          <div className="mb-4 rounded-xl border border-aegis-primary/15 bg-[rgb(var(--aegis-overlay)/0.035)] overflow-hidden text-left">
            <div
              className="h-1.5 bg-aegis-surface overflow-hidden"
              role="progressbar"
              aria-label={t('offline.recoveryProgress', 'Gateway 恢复进度')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
            >
              <div
                className="h-full bg-aegis-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <div className="px-3 py-2">
              <div className="flex items-start justify-between gap-3 text-[10px] font-semibold text-aegis-primary mb-1">
                <span className="min-w-0 leading-relaxed">{progressMessage}</span>
                <span className="shrink-0 font-mono tabular-nums">{progressValue}%</span>
              </div>
              {openControlUiWhenReady && (
                <p className="mb-2 text-[10px] leading-relaxed text-aegis-text-muted">
                  {t('offline.controlUiQueued', 'Gateway 就绪后将自动打开 Control UI。')}
                </p>
              )}
              {recoveryLogText && (
                <div className="border-t border-aegis-border/50 pt-2">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-medium text-aegis-text-dim">{t('offline.recentLogs', '最近日志')}</span>
                    <button
                      type="button"
                      onClick={copyRecoveryLogs}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-aegis-text-dim transition-colors hover:bg-aegis-surface hover:text-aegis-text"
                    >
                      {logsCopied ? <Check size={11} className="text-aegis-success" /> : <Copy size={11} />}
                      {logsCopied ? t('offline.logsCopied', '已复制') : t('offline.copyLogs', '复制日志')}
                    </button>
                  </div>
                  <pre ref={logsRef} className="max-h-24 overflow-y-auto rounded-md bg-aegis-bg/45 px-2 py-1.5 text-[10px] leading-relaxed font-mono text-aegis-text-dim whitespace-pre-wrap">
                    {recoveryLogText}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {!connecting && !showProgress && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-aegis-text-dim mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-aegis-warning/60 animate-pulse" />
            {t('offline.retrying')}
          </div>
        )}

        <GatewaySelfRescuePanel
          className="mt-5 text-left"
          variant="full"
          connected={connected}
          busy={recoveryBusy}
          progressMessage={showProgress ? progressMessage : null}
          progressPercent={showProgress ? progressValue : null}
          primaryActionLabel={recoveryBusy
            ? t('gatewayError.actions.retrying', '正在重启…')
            : t('boot.restartGateway', '重启 Gateway')}
          onPrimaryAction={() => requestRecovery('offline', false, 'restart')}
          onReconnect={() => requestRecovery('offline')}
          onOpenLogs={openLogsPage}
          error={isRecovering ? undefined : lastError || (progressFailed ? progressMessage : undefined)}
          logs={restartInfo.logs.slice(-40).join('\n')}
        />

        {window.aegis?.consoleUi && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={() => void openControlUi()}
              disabled={recoveryBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px]
                text-aegis-text-dim hover:text-aegis-text
                border border-aegis-border/20 hover:border-aegis-border/40 transition-colors
                disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MonitorDot size={11} /> {t('settings.controlUi', 'Control UI')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
