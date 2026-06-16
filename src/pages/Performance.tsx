// Performance — 1:1 Nezha Dash server detail page design.
// Data from Rust sysinfo background thread via Tauri event stream.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, ArrowLeft } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import type { SystemMetricsPayload } from '@/api/tauri-adapter';
import clsx from 'clsx';

import { formatBytes } from '@/utils/format';

function fmtSpeed(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(2)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}
function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d} Days ${h} Hours` : h > 0 ? `${h} Hours` : `${Math.floor(secs / 60)} Min`;
}

function UsageBar({ value }: { value: number }) {
  return (
    <div className="h-[3px] rounded-sm bg-stone-200 dark:bg-stone-800 w-full overflow-hidden">
      <div className={clsx(
        'h-full rounded-sm transition-all duration-700',
        value > 90 ? 'bg-red-500' : value > 70 ? 'bg-orange-400' : 'bg-green-500'
      )} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// Nezha-style stat pill: label + value
function StatPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-1.5 py-1">
      <p className="text-muted-foreground text-[10px] text-aegis-text-dim mb-0.5">{label}</p>
      <div className="text-xs text-aegis-text">{children}</div>
    </div>
  );
}

export function Performance() {
  const { t } = useTranslation();
  const { connected, tokenUsage, sessions } = useChatStore();
  const agents = useGatewayDataStore(s => s.agents);
  const [ping, setPing] = useState<number | null>(null);
  const [m, setM] = useState<SystemMetricsPayload>({ cpu:0,cpu_count:0,mem_used:0,mem_total:0,disk_used:0,disk_total:0,net_up_speed:0,net_down_speed:0,uptime:0,load1:0,load5:0,load15:0,platform:'',platform_version:'',arch:'' });

  useEffect(() => {
    const unsub = (window.aegis as any)?.systemMetrics?.onMetrics?.((metrics: SystemMetricsPayload) => setM(metrics));
    return () => { unsub?.(); };
  }, []);

  const measurePing = useCallback(async () => {
    const s = Date.now(); try { await gateway.getStatus(); setPing(Date.now() - s); } catch { setPing(null); }
  }, []);
  useEffect(() => { measurePing(); const i = setInterval(measurePing, 30000); return () => clearInterval(i); }, [measurePing]);

  const memPct = m.mem_total > 0 ? Math.round((m.mem_used / m.mem_total) * 100) : 0;
  const diskPct = m.disk_total > 0 ? Math.round((m.disk_used / m.disk_total) * 100) : 0;
  const onlineAgents = agents.filter(a => sessions.some(s => s.key.includes(a.id))).length;
  const offlineAgents = agents.length - onlineAgents;
  const ctxTokens = tokenUsage?.contextTokens ?? 0;
  const maxTokens = tokenUsage?.maxTokens ?? 0;
  const ctxPct = maxTokens > 0 ? Math.round((ctxTokens / maxTokens) * 100) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-aegis-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <Activity size={16} className="text-aegis-primary" />
          <h1 className="text-sm font-bold text-aegis-text">{t('nav.performance', '准端')}</h1>
          <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')} />
          <span className="text-[10px] text-aegis-text-dim">{ping}ms</span>
        </div>
        <button onClick={measurePing} className="p-2 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)]">
          <RefreshCw size={14} className="text-aegis-text-muted" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-5xl p-6 space-y-2">
          {/* ═══ Header — Nezha ServerDetailClient ═══ */}
          <div>
            {/* Server name */}
            <div className="flex items-center gap-1.5 font-semibold text-xl text-aegis-text leading-none tracking-tight mb-3">
              <ArrowLeft size={18} className="text-aegis-text-muted" />
              {m.platform ? `${m.platform} (localhost)` : 'JunQi Desktop'}
            </div>

            {/* Row 1: Status | Uptime | Version | Arch | Mem | Disk */}
            <section className="flex flex-wrap gap-x-2 gap-y-0">
              <StatPill label={t('perf.status', '状态')}>
                <span className={clsx('inline-block rounded-[6px] px-1.5 py-px text-[10px] font-medium text-white', connected ? 'bg-green-600' : 'bg-red-600')}>
                  {connected ? t('perf.online', 'Online') : t('perf.offline', 'Offline')}
                </span>
              </StatPill>
              <StatPill label={t('perf.uptime', 'Uptime')}>
                {m.uptime > 0 ? fmtUptime(m.uptime) : '—'}
              </StatPill>
              <StatPill label={t('perf.version', 'Version')}>
                {m.platform_version || '—'}
              </StatPill>
              <StatPill label={t('perf.arch', 'Arch')}>
                {m.arch || '—'}
              </StatPill>
              <StatPill label="Mem">{formatBytes(m.mem_total)}</StatPill>
              <StatPill label="Disk">{formatBytes(m.disk_total)}</StatPill>
            </section>

            {/* Row 2: System | CPU cores */}
            <section className="flex flex-wrap gap-x-2 gap-y-0 mt-1">
              <StatPill label={t('perf.system', 'System')}>
                {m.platform} {m.platform_version}
              </StatPill>
              <StatPill label="CPU">
                {m.cpu_count} cores
              </StatPill>
              <StatPill label={t('perf.cpuModel', 'CPU Model')}>
                Apple Silicon
              </StatPill>
            </section>

            {/* Row 3: Load | Upload | Download */}
            <section className="flex flex-wrap gap-x-2 gap-y-0 mt-1">
              <StatPill label="Load">
                {m.load1.toFixed(2)} / {m.load5.toFixed(2)} / {m.load15.toFixed(2)}
              </StatPill>
              <StatPill label={t('perf.upload', 'Upload')}>
                {fmtSpeed(m.net_up_speed)}
              </StatPill>
              <StatPill label={t('perf.download', 'Download')}>
                {fmtSpeed(m.net_down_speed)}
              </StatPill>
            </section>
          </div>

          {/* ═══ Summary Bar — Nezha ServerDetailSummary ═══ */}
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-aegis-border/30 pb-3">
            <section className="flex w-24 flex-col justify-center gap-1 px-1.5 py-1">
              <section className="flex items-center justify-between">
                <span className="text-[10px] text-aegis-text-dim">CPU</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{m.cpu.toFixed(1)}%</span>
              </section>
              <UsageBar value={m.cpu} />
            </section>
            <section className="flex w-24 flex-col justify-center gap-1 px-1.5 py-1">
              <section className="flex items-center justify-between">
                <span className="text-[10px] text-aegis-text-dim">Mem</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{memPct}%</span>
              </section>
              <UsageBar value={memPct} />
            </section>
            <section className="flex w-24 flex-col justify-center gap-1 px-1.5 py-1">
              <section className="flex items-center justify-between">
                <span className="text-[10px] text-aegis-text-dim">Disk</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{diskPct}%</span>
              </section>
              <UsageBar value={diskPct} />
            </section>
            <section className="flex w-24 flex-col justify-center gap-1 px-1.5 py-1">
              <section className="flex items-center justify-between">
                <span className="text-[10px] text-aegis-text-dim">Ctx</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{ctxPct}%</span>
              </section>
              <UsageBar value={ctxPct} />
            </section>
            <section className="flex min-w-[70px] flex-col justify-center px-1.5 py-1">
              <section className="flex items-center justify-between gap-4">
                <span className="text-[10px] text-aegis-text-dim">Agents</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{agents.length}</span>
              </section>
              <section className="flex items-center justify-between gap-4">
                <span className="text-[10px] text-aegis-text-dim">Sessions</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{sessions.length}</span>
              </section>
            </section>
            <section className="flex min-w-[120px] flex-col justify-center gap-0.5 px-1.5 py-1">
              <section className="flex items-center justify-between gap-4">
                <span className="text-[10px] text-aegis-text-dim">{t('perf.upload', 'Upload')}</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{fmtSpeed(m.net_up_speed)}</span>
              </section>
              <section className="flex items-center justify-between gap-4">
                <span className="text-[10px] text-aegis-text-dim">{t('perf.download', 'Download')}</span>
                <span className="font-medium text-[10px] tabular-nums text-aegis-text">{fmtSpeed(m.net_down_speed)}</span>
              </section>
            </section>
          </div>

          {/* ═══ Overview Cards — Nezha ServerOverviewClient ═══ */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="group cursor-pointer rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-3 transition-all hover:ring-2 hover:ring-blue-500/50">
              <p className="text-xs font-medium text-aegis-text-muted">{t('perf.totalAgents', 'Total Agents')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="font-semibold text-lg tabular-nums text-aegis-text">{agents.length}</span>
              </div>
            </div>
            <div className={clsx('group cursor-pointer rounded-xl border bg-aegis-surface/60 px-5 py-3 transition-all hover:ring-2',
              onlineAgents > 0 ? 'border-green-500/30 hover:ring-green-500/50' : 'border-aegis-border/40')}>
              <p className="text-xs font-medium text-aegis-text-muted">{t('perf.activeAgents', 'Online Agents')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-semibold text-lg tabular-nums text-aegis-text">{onlineAgents}</span>
              </div>
            </div>
            <div className="group cursor-pointer rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-3 transition-all hover:ring-2 hover:ring-red-500/50">
              <p className="text-xs font-medium text-aegis-text-muted">{t('perf.offlineAgents', 'Offline Agents')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="font-semibold text-lg tabular-nums text-aegis-text">{offlineAgents}</span>
              </div>
            </div>
            <div className="group cursor-pointer rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-3 transition-all hover:ring-2 hover:ring-purple-500/50">
              <p className="text-xs font-medium text-aegis-text-muted">{t('perf.sessions', 'Active Sessions')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="font-semibold text-lg tabular-nums text-aegis-text">{sessions.length}</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default Performance;
