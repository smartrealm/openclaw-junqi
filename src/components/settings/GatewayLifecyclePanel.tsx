import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  RefreshCw,
  ServerCog,
} from 'lucide-react';
import { getGatewayLogs, type LogEntry } from '@/api/tauri-commands';
import clsx from 'clsx';

type GatewayLifecycle = 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';
type GatewayRuntimeMode = 'none' | 'external' | 'system_service' | 'managed_child' | 'docker';
type PanelVariant = 'compact' | 'full';

interface GatewayRuntimeSnapshot {
  lifecycle: GatewayLifecycle;
  mode: GatewayRuntimeMode;
  port: number;
  managed_pid: number | null;
}

interface ProgressEvent {
  step?: string;
  message?: string;
  progress?: number | null;
  key?: string;
  params?: Record<string, unknown>;
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
    case 'starting':
    case 'reconnecting': return Loader2;
    case 'error': return AlertTriangle;
    case 'stopped':
    default: return Circle;
  }
}

function lifecycleLabel(t: ReturnType<typeof useTranslation>['t'], lifecycle: GatewayLifecycle): string {
  return t(`gateway.lifecycle.${lifecycle}`, {
    defaultValue: ({
      stopped: 'Stopped',
      starting: 'Starting',
      running: 'Running',
      error: 'Error',
      reconnecting: 'Reconnecting',
    } as Record<GatewayLifecycle, string>)[lifecycle],
  });
}

function runtimeModeLabel(t: ReturnType<typeof useTranslation>['t'], mode: GatewayRuntimeMode): string {
  return t(`gateway.runtimeMode.${mode}`, {
    defaultValue: ({
      none: '未运行',
      external: '外部实例',
      system_service: '系统服务',
      managed_child: 'JunQi 托管',
      docker: 'Docker',
    } as Record<GatewayRuntimeMode, string>)[mode],
  });
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
  const [runtimeMode, setRuntimeMode] = useState<GatewayRuntimeMode>('none');
  const [runtimePort, setRuntimePort] = useState(18789);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestProgress, setLatestProgress] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [snapshot, nextLogs] = await Promise.all([
        invoke<GatewayRuntimeSnapshot>('get_gateway_runtime_snapshot').catch(() => null),
        getGatewayLogs(variant === 'full' ? 12 : 4).catch(() => []),
      ]);
      if (snapshot) {
        setLifecycle(snapshot.lifecycle);
        setRuntimeMode(snapshot.mode);
        setRuntimePort(snapshot.port);
      }
      setLogs(nextLogs);
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
    let setupUnlisten: UnlistenFn | undefined;
    let gatewayUnlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<ProgressEvent>('setup-progress', (event) => {
      if (cancelled || event.payload?.step !== 'gateway') return;
      const message = resolveProgressMessage(t, event.payload);
      if (message) setLatestProgress(message);
      if (typeof event.payload.progress === 'number') setProgress(event.payload.progress);
      void refresh();
    }).then((fn) => {
      if (cancelled) fn(); else setupUnlisten = fn;
    }).catch(() => undefined);

    listen<string>('gateway-log', (event) => {
      if (cancelled || !event.payload) return;
      setLatestProgress(event.payload);
      void refresh();
    }).then((fn) => {
      if (cancelled) fn(); else gatewayUnlisten = fn;
    }).catch(() => undefined);

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
      setupUnlisten?.();
      gatewayUnlisten?.();
      window.removeEventListener('aegis:gateway-progress', onLocalProgress);
    };
  }, [refresh, t]);

  const recentEvents = useMemo(() => {
    const lifecycleEvents = logs
      .filter((entry) => entry.source === 'lifecycle')
      .slice(-5);
    return lifecycleEvents.length > 0 ? lifecycleEvents : logs.slice(-5);
  }, [logs]);

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
              {t('gateway.lifecyclePanel.title', 'Gateway 状态')}
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
              <Icon size={12} className={tone === 'run' ? 'animate-spin' : ''} />
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
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-aegis-border/40 px-3 py-1.5 text-[11px] text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('settings.refresh', 'Refresh')}
          </button>
        )}
      </div>

      {(latestProgress || !isFull) && (
        <div className="mt-3 flex min-h-[38px] items-start gap-2 rounded-md bg-aegis-bg/55 px-3 py-2 text-[12px] leading-5 text-aegis-text-secondary">
          <Activity size={13} className="mt-0.5 shrink-0 text-aegis-primary" />
          <span className="break-words">
            {latestProgress ?? t('gateway.lifecyclePanel.waiting', '等待 Gateway 状态更新')}
          </span>
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
                  <StepIcon size={12} className={active && (item === 'starting' || item === 'reconnecting') ? 'animate-spin text-aegis-warning' : ''} />
                  {lifecycleLabel(t, item)}
                </div>
              </div>
            );
          })}
        </div>
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
