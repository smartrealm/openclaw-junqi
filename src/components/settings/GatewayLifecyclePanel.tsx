import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gatewayLifecycle } from '@/runtime/gatewayLifecycle';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Power,
  RefreshCw,
  ServerCog,
  Square,
} from 'lucide-react';
import {
  disableGatewayAutostart,
  enableGatewayAutostart,
  gatewayAutostartStatus,
  getGatewayLogs,
  getGatewayRuntimeSnapshot,
  handoffGatewayToOfficialService,
  type GatewayAutostartStatus,
  type GatewayLifecycleState,
  type GatewaySupervisorRuntimeMode,
  type LogEntry,
} from '@/api/tauri-commands';
import clsx from 'clsx';
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';
import { translateGatewayLogPayload } from '@/hooks/gatewayLogEvents';
import { DEFAULT_GATEWAY_PORT } from '@/config/runtimeDefaults';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { presentGatewayAutostart } from './gatewayAutostartPresentation';

type GatewayLifecycle = GatewayLifecycleState;
type PanelVariant = 'compact' | 'full';

interface ProgressEvent {
  step?: string;
  message?: string;
  progress?: number | null;
  key?: string;
  params?: Record<string, unknown>;
  operationId?: string | null;
}

interface GatewayLifecyclePanelProps {
  variant?: PanelVariant;
  className?: string;
}

const LIFECYCLE_ORDER: GatewayLifecycle[] = ['stopped', 'starting', 'reconnecting', 'running', 'error'];

function lifecycleTone(lifecycle: GatewayLifecycle): 'ok' | 'warn' | 'err' | 'idle' | 'run' {
  switch (lifecycle) {
    case 'running': return 'ok';
    case 'starting':
    case 'reconnecting': return 'run';
    case 'error': return 'err';
    case 'stopped':
    default: return 'idle';
  }
}

function lifecycleIcon(lifecycle: GatewayLifecycle) {
  switch (lifecycle) {
    case 'running': return CheckCircle2;
    case 'error': return AlertTriangle;
    case 'stopped':
    case 'starting':
    case 'reconnecting':
    default: return Circle;
  }
}

function lifecycleLabel(t: ReturnType<typeof useTranslation>['t'], lifecycle: GatewayLifecycle): string {
  return t(`gateway.lifecycle.${lifecycle}`);
}

function runtimeModeLabel(t: ReturnType<typeof useTranslation>['t'], mode: GatewaySupervisorRuntimeMode): string {
  return t(`gateway.runtimeMode.${mode}`);
}

function resolveProgressMessage(t: ReturnType<typeof useTranslation>['t'], detail: ProgressEvent): string | null {
  if (typeof detail.message !== 'string') return null;
  if (typeof detail.key !== 'string') return detail.message;
  const translated = t(detail.key, { defaultValue: detail.message, ...(detail.params ?? {}) });
  return translated === detail.key ? detail.message : String(translated);
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function statusDotClass(tone: ReturnType<typeof lifecycleTone>): string {
  switch (tone) {
    case 'ok': return 'bg-aegis-success';
    case 'run': return 'bg-aegis-warning animate-pulse';
    case 'err': return 'bg-aegis-danger';
    case 'warn': return 'bg-aegis-warning';
    case 'idle':
    default: return 'bg-aegis-text-dim';
  }
}

export function GatewayLifecyclePanel({ variant = 'compact', className }: GatewayLifecyclePanelProps) {
  const { t } = useTranslation();
  const [lifecycle, setLifecycle] = useState<GatewayLifecycle>('stopped');
  const [runtimeMode, setRuntimeMode] = useState<GatewaySupervisorRuntimeMode>('none');
  const [runtimePort, setRuntimePort] = useState(DEFAULT_GATEWAY_PORT);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestProgress, setLatestProgress] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [autostart, setAutostart] = useState<GatewayAutostartStatus | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [snapshot, nextLogs, nextAutostart] = await Promise.all([
        getGatewayRuntimeSnapshot().catch(() => null),
        getGatewayLogs(variant === 'full' ? 12 : 4).catch(() => []),
        variant === 'full' ? gatewayAutostartStatus().catch(() => null) : Promise.resolve(null),
      ]);
      if (snapshot) {
        setLifecycle(snapshot.lifecycle);
        setRuntimeMode(snapshot.mode);
        setRuntimePort(snapshot.port);
      }
      setLogs(nextLogs);
      if (variant === 'full') setAutostart(nextAutostart);
    } finally {
      setLoading(false);
    }
  }, [variant]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, variant === 'full' ? 5000 : 8000);
    return () => window.clearInterval(id);
  }, [refresh, variant]);

  useEffect(() => {
    let cancelled = false;

    const setupUnlisten = subscribeTauriEvent<ProgressEvent>('setup-progress', (event) => {
      if (cancelled || event.payload?.operationId || event.payload?.step !== 'gateway') return;
      const message = resolveProgressMessage(t, event.payload);
      if (message) setLatestProgress(message);
      if (typeof event.payload.progress === 'number') setProgress(event.payload.progress);
      void refresh();
    });

    const gatewayUnlisten = subscribeTauriEvent('gateway-log', (event) => {
      if (cancelled) return;
      const message = translateGatewayLogPayload(
        event.payload,
        (key, options) => t(key, options),
      );
      if (!message) return;
      setLatestProgress(message);
      void refresh();
    });

    const onLocalProgress = (event: Event) => {
      if (cancelled) return;
      const detail = (event as CustomEvent<ProgressEvent>).detail;
      if (detail?.step !== 'gateway') return;
      const message = resolveProgressMessage(t, detail);
      if (message) setLatestProgress(message);
      if (typeof detail.progress === 'number') setProgress(detail.progress);
      void refresh();
    };
    window.addEventListener('aegis:gateway-progress', onLocalProgress);

    return () => {
      cancelled = true;
      combineUnlisteners([setupUnlisten, gatewayUnlisten])();
      window.removeEventListener('aegis:gateway-progress', onLocalProgress);
    };
  }, [refresh, t]);

  // 停止会中断运行中的会话，因此要求用户在限定时间内再次确认。
  const [stopArmed, setStopArmed] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => {
    if (!stopArmed) return;
    const timer = window.setTimeout(() => setStopArmed(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [stopArmed]);

  const stopSelectedGateway = useCallback(async () => {
    if (stopBusy) return;
    if (!stopArmed) {
      setStopArmed(true);
      return;
    }
    setStopArmed(false);
    setStopBusy(true);
    setStopError(null);
    try {
      const stopped = await gatewayLifecycle.stop('gateway-lifecycle-panel');
      if (!stopped.success) throw new Error(stopped.error ?? t('gatewayLifecycle.stopFailed'));
      await refresh();
    } catch (cause) {
      setStopError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopBusy(false);
    }
  }, [refresh, stopArmed, stopBusy, t]);

  const toggleAutostart = useCallback(async () => {
    if (!autostart || !autostart.supported || autostartBusy) return;
    setAutostartBusy(true);
    setAutostartError(null);
    try {
      if (autostart.enabled) {
        const next = await disableGatewayAutostart();
        setAutostart(next);
        const restarted = await gatewayLifecycle.restart('gateway-autostart-disabled');
        if (!restarted.success) throw new Error(restarted.error || 'Gateway restart failed');
      } else {
        const next = await enableGatewayAutostart();
        setAutostart(next);
        if (!(await handoffGatewayToOfficialService())) {
          throw new Error(t('setup.autostart.handoffFailed'));
        }
      }
      await refresh();
    } catch (cause) {
      setAutostartError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAutostartBusy(false);
    }
  }, [autostart, autostartBusy, refresh, t]);

  const recentEvents = useMemo(() => {
    const lifecycleEvents = logs
      .filter((entry) => entry.source === 'lifecycle')
      .slice(-5);
    return lifecycleEvents.length > 0 ? lifecycleEvents : logs.slice(-5);
  }, [logs]);
  const autostartPresentation = autostart ? presentGatewayAutostart(autostart, t) : null;

  const Icon = lifecycleIcon(lifecycle);
  const tone = lifecycleTone(lifecycle);
  const percent = progress == null ? null : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const isFull = variant === 'full';
  const showActivity = isFull || recentEvents.length > 0;

  return (
    <section
      className={clsx(
        'border border-aegis-border/45 bg-aegis-surface/55',
        isFull ? 'rounded-xl p-4' : 'rounded-lg p-3 min-h-[112px]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ServerCog size={isFull ? 17 : 15} className="text-aegis-primary" />
            <h3 className={clsx('font-semibold text-aegis-text', isFull ? 'text-[14px]' : 'text-[13px]')}>
              {t('gateway.lifecyclePanel.title')}
            </h3>
            <span className={clsx('h-2 w-2 rounded-full', statusDotClass(tone))} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className={clsx(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium',
              tone === 'ok' && 'border-aegis-success/25 bg-aegis-success/10 text-aegis-success',
              tone === 'run' && 'border-aegis-warning/25 bg-aegis-warning/10 text-aegis-warning',
              tone === 'err' && 'border-aegis-danger/25 bg-aegis-danger/10 text-aegis-danger',
              tone === 'idle' && 'border-aegis-border bg-aegis-bg/50 text-aegis-text-dim',
            )}>
              {tone === 'run'
                ? <LoadingIndicator size={12} />
                : <Icon size={12} />}
              {lifecycleLabel(t, lifecycle)}
            </span>
            <span className="inline-flex items-center rounded-md border border-aegis-border bg-aegis-bg/50 px-2 py-1 font-mono text-[11px] text-aegis-text-muted">
              {runtimeModeLabel(t, runtimeMode)} · :{runtimePort}
            </span>
            {percent != null && tone === 'run' && (
              <span className="font-mono text-aegis-text-muted">{percent}%</span>
            )}
          </div>
        </div>
        {isFull && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void stopSelectedGateway()}
              disabled={stopBusy || lifecycle === 'stopped'}
              aria-label={t('gatewayLifecycle.stop', '停止 Gateway')}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition-colors disabled:opacity-50',
                stopArmed
                  ? 'border-aegis-danger/45 bg-aegis-danger/10 text-aegis-danger'
                  : 'border-aegis-border/40 text-aegis-text-dim hover:text-aegis-text',
              )}
            >
              {stopBusy
                ? <LoadingIndicator size={12} />
                : <Square size={12} />}
              {stopArmed
                ? t('gatewayLifecycle.stopConfirm', '确认停止？进行中的会话会中断')
                : t('gatewayLifecycle.stop', '停止 Gateway')}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-aegis-border/40 px-3 py-1.5 text-[11px] text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {t('settings.refresh', 'Refresh')}
            </button>
          </div>
        )}
      </div>

      {(latestProgress || !isFull) && (
        <div className="mt-3 flex min-h-[38px] items-start gap-2 rounded-md bg-aegis-bg/55 px-3 py-2 text-[12px] leading-5 text-aegis-text-secondary">
          <Activity size={13} className="mt-0.5 shrink-0 text-aegis-primary" />
          <span className="break-words">
            {latestProgress ?? t('gateway.lifecyclePanel.waiting')}
          </span>
        </div>
      )}

      {isFull && autostart?.supported && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-aegis-border/35 bg-aegis-bg/35 p-3">
          <Power size={15} className="mt-0.5 shrink-0 text-aegis-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-aegis-text">
              <span>{autostartPresentation?.title}</span>
              {autostartPresentation?.badge && (
                <span className={clsx(
                  'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                  autostart.running
                    ? 'border-aegis-success/30 bg-aegis-success/10 text-aegis-success'
                    : 'border-aegis-warning/30 bg-aegis-warning/10 text-aegis-warning',
                )}>
                  {autostartPresentation.badge}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">
              {autostartPresentation?.description}
            </p>
            {autostartError && <p className="mt-1 break-words text-[11px] text-aegis-danger">{autostartError}</p>}
          </div>
          <button
            type="button"
            onClick={() => void toggleAutostart()}
            disabled={autostartBusy}
            className="shrink-0 rounded-lg border border-aegis-border/45 px-3 py-1.5 text-[11px] font-semibold text-aegis-text-secondary transition hover:bg-aegis-surface disabled:opacity-50"
          >
            {autostartBusy
              ? t('setup.autostart.switching', '正在切换 OpenClaw 的运行方式,请稍候…')
              : autostartPresentation?.action}
          </button>
        </div>
      )}

      {isFull && (
        <div className="mt-4 grid gap-2 sm:grid-cols-5">
          {LIFECYCLE_ORDER.map((item) => {
            const active = item === lifecycle;
            const StepIcon = lifecycleIcon(item);
            return (
              <div
                key={item}
                className={clsx(
                  'min-h-[62px] rounded-lg border px-3 py-2',
                  active
                    ? 'border-aegis-primary/45 bg-aegis-primary/10 text-aegis-text'
                    : 'border-aegis-border/35 bg-aegis-bg/35 text-aegis-text-dim',
                )}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  {active && (item === 'starting' || item === 'reconnecting')
                    ? <LoadingIndicator size={12} className="text-aegis-warning" />
                    : <StepIcon size={12} />}
                  {lifecycleLabel(t, item)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {stopError && (
        // 停止失败时 Gateway 仍可能运行，必须就近展示原因。
        <p className="mt-3 break-words text-[11px] leading-5 text-aegis-danger">
          {t('gatewayLifecycle.stopFailed', '停止 Gateway 失败')}: {stopError}
        </p>
      )}

      {showActivity && recentEvents.length > 0 && (
        <div className={clsx('mt-3 space-y-1.5', !isFull && 'max-h-[86px] overflow-hidden')}>
          {recentEvents.map((entry, index) => (
            <div key={`${entry.timestamp_ms}-${index}`} className="flex items-start gap-2 text-[11px] leading-5">
              <Clock3 size={11} className="mt-1 shrink-0 text-aegis-text-dim" />
              <span className="shrink-0 font-mono text-aegis-text-dim">{fmtTime(entry.timestamp_ms)}</span>
              <span className="min-w-0 break-words text-aegis-text-muted">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
