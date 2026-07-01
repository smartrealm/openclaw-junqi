/**
 * GatewayLogPanel — viewer for the Rust-side 200-entry circular buffer.
 *
 * SPEC §M6 / T5. The backend buffer lives in `GatewayProcess::logs`
 * (src-tauri/src/state/gateway_process.rs); this panel calls
 * `get_gateway_logs(limit)` and `clear_gateway_logs()` over Tauri IPC.
 *
 * Behaviour:
 *   - Auto-refreshes every 5s while the Storage tab is open.
 *   - Manual "Refresh" button re-invokes immediately.
 *   - "Clear" button calls `clear_gateway_logs` and reloads.
 *   - Shows level tag + source tag + timestamp for each entry so the user
 *     can spot which logs came from native vs docker vs lifecycle events.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, Trash2, ScrollText, Info, AlertTriangle, AlertCircle, Bug } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import clsx from 'clsx';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
type LogSource = 'child_stdout' | 'child_stderr' | 'docker_stdout' | 'docker_stderr' | 'lifecycle';

interface LogEntry {
  timestamp_ms: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

const LEVEL_ICON: Record<LogLevel, typeof Info> = {
  trace: Bug,
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: 'text-aegis-text-dim',
  debug: 'text-aegis-text-dim',
  info: 'text-aegis-text',
  warn: 'text-aegis-warning',
  error: 'text-aegis-danger',
};

const SOURCE_LABEL: Record<LogSource, string> = {
  child_stdout: 'native',
  child_stderr: 'native!',
  docker_stdout: 'docker',
  docker_stderr: 'docker!',
  lifecycle: 'lifecycle',
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const xxx = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${xxx}`;
}

export function GatewayLogPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<LogEntry[]>('get_gateway_logs', { limit: 200 });
      setEntries(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke('clear_gateway_logs');
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Initial load + auto-refresh every 5s.
  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <GlassCard delay={0.32}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-aegis-text flex items-center gap-2">
          <ScrollText size={16} className="text-aegis-primary" />
          {t('settings.gatewayLog.title', 'Gateway Log')}
          <span className="ml-2 text-[11px] text-aegis-text-dim font-normal">
            ({entries.length}/200)
          </span>
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] border transition-colors',
              loading
                ? 'text-aegis-text-dim/60 border-aegis-border/10 cursor-not-allowed'
                : 'text-aegis-text-dim hover:text-aegis-text border-aegis-border/20 hover:border-aegis-border/40',
            )}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('settings.refresh', 'Refresh')}
          </button>
          <button
            onClick={() => void clear()}
            disabled={loading || entries.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-danger hover:border-aegis-danger/30 transition-colors disabled:opacity-40"
          >
            <Trash2 size={12} />
            {t('settings.gatewayLog.clear', 'Clear')}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-aegis-danger mb-2">{error}</div>
      )}

      <div className="rounded-lg border border-aegis-border/20 bg-[rgb(var(--aegis-overlay)/0.03)] overflow-hidden">
        <div className="max-h-[280px] overflow-y-auto font-mono text-[11px] leading-relaxed">
          {entries.length === 0 ? (
            <div className="px-3 py-4 text-aegis-text-dim text-center">
              {t('settings.gatewayLog.empty', 'No log entries yet. Start the Gateway to see stdout/stderr here.')}
            </div>
          ) : (
            entries.map((e, i) => {
              const Icon = LEVEL_ICON[e.level] || Info;
              return (
                <div
                  key={`${e.timestamp_ms}-${i}`}
                  className="flex items-start gap-2 px-3 py-1 hover:bg-[rgb(var(--aegis-overlay)/0.04)] border-b border-aegis-border/10 last:border-b-0"
                >
                  <span className="text-aegis-text-dim shrink-0 tabular-nums">
                    {fmtTime(e.timestamp_ms)}
                  </span>
                  <Icon size={11} className={clsx('shrink-0 mt-0.5', LEVEL_COLOR[e.level])} />
                  <span className={clsx('shrink-0 uppercase', LEVEL_COLOR[e.level])} style={{ minWidth: 36 }}>
                    {e.level}
                  </span>
                  <span className="shrink-0 text-aegis-text-muted" style={{ minWidth: 56 }}>
                    [{SOURCE_LABEL[e.source]}]
                  </span>
                  <span className="text-aegis-text break-all whitespace-pre-wrap">{e.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </GlassCard>
  );
}