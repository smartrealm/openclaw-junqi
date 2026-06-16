// Performance Monitor — 1:1 Nezha Dash design.
// Data from Rust sysinfo background thread via Tauri event stream.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, Wifi, WifiOff, Server, CircleCheck, CircleX, Cpu, MemoryStick, HardDrive, Network, ArrowUp, ArrowDown, Monitor } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import type { SystemMetricsPayload } from '@/api/tauri-adapter';
import clsx from 'clsx';

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)}G`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}
function fmtSpeed(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(2)}M/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)}K/s`;
  return `${bps}B/s`;
}
function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${Math.floor((secs % 3600) / 60)}m` : `${Math.floor(secs / 60)}m`;
}

// ── Nezha-style UsageBar: 3px thin, green < 70 < orange < 90 < red ──
function UsageBar({ value }: { value: number }) {
  return (
    <div className="h-[3px] rounded-sm bg-[rgb(var(--aegis-overlay)/0.12)] w-full overflow-hidden">
      <div className={clsx(
        'h-full rounded-sm transition-all duration-700',
        value > 90 ? 'bg-red-500' : value > 70 ? 'bg-orange-400' : 'bg-green-500'
      )} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// ── Nezha-style compact metric section ──
function CompactMetric({ label, value, unit, showBar, barValue, pct }: {
  label: string; value: string; unit?: string; showBar?: boolean; barValue?: number; pct?: number;
}) {
  return (
    <section className="flex flex-col justify-center gap-1 px-1.5 py-1 min-w-[90px]">
      <section className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-aegis-text-dim">{label}</span>
        <span className="font-medium text-[10px] tabular-nums text-aegis-text">
          {value}{unit && <span className="text-[9px] text-aegis-text-dim ml-0.5">{unit}</span>}
        </span>
      </section>
      {showBar && barValue !== undefined && <UsageBar value={barValue} />}
    </section>
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

  const ctxTokens = tokenUsage?.contextTokens ?? 0;
  const maxTokens = tokenUsage?.maxTokens ?? 0;
  const ctxPct = maxTokens > 0 ? Math.round((ctxTokens / maxTokens) * 100) : 0;
  const memPct = m.mem_total > 0 ? Math.round((m.mem_used / m.mem_total) * 100) : 0;
  const diskPct = m.disk_total > 0 ? Math.round((m.disk_used / m.disk_total) * 100) : 0;

  const onlineAgents = agents.filter(a => sessions.some(s => s.key.includes(a.id))).length;
  const offlineAgents = agents.length - onlineAgents;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar — Nezha-style */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-aegis-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <Activity size={16} className="text-aegis-primary" />
          <h1 className="text-sm font-bold text-aegis-text">{t('nav.performance', '准端')}</h1>
          <div className="flex items-center gap-2 text-[10px] text-aegis-text-dim">
            <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')} />
            <span>{connected ? t('perf.online', '在线') : t('perf.offline', '离线')}</span>
            {ping && <span>{ping}ms</span>}
            {m.platform && <span className="opacity-60">{m.platform} {m.platform_version}</span>}
            {m.uptime > 0 && <span className="opacity-60">↑ {fmtUptime(m.uptime)}</span>}
          </div>
        </div>
        <button onClick={measurePing} className="p-2 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
          <RefreshCw size={14} className="text-aegis-text-muted" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* ── 1. Nezha-style Overview Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-4 cursor-pointer hover:border-blue-500/50 transition-all">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-aegis-text-muted">{t('perf.totalAgents', 'Agents 总数')}</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="font-semibold text-xl text-aegis-text tabular-nums">{agents.length}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-4 cursor-pointer hover:border-green-500/50 transition-all">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-aegis-text-muted">{t('perf.activeAgents', '活跃 Agent')}</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-semibold text-xl text-aegis-text tabular-nums">{onlineAgents}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-4 cursor-pointer hover:border-red-500/50 transition-all">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-aegis-text-muted">{t('perf.offlineAgents', '离线 Agent')}</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="font-semibold text-xl text-aegis-text tabular-nums">{offlineAgents}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-5 py-4 cursor-pointer hover:border-purple-500/50 transition-all">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-aegis-text-muted">{t('perf.sessions', '会话')}</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="font-semibold text-xl text-aegis-text tabular-nums">{sessions.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 2. Nezha-style System Metrics Summary Bar ── */}
        <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            <CompactMetric label="CPU" value={m.cpu.toFixed(1)} unit="%" showBar barValue={m.cpu} />
            <CompactMetric label={t('perf.memory', 'Mem')} value={memPct.toFixed(1)} unit="%" showBar barValue={memPct} />
            <CompactMetric label={t('perf.disk', 'Disk')} value={diskPct.toFixed(1)} unit="%" showBar barValue={diskPct} />
            <CompactMetric label={t('perf.ctxUsage', 'Ctx')} value={ctxPct.toString()} unit="%" showBar barValue={ctxPct} />
            <CompactMetric label="Load" value={`${m.load1.toFixed(1)}/${m.load5.toFixed(1)}/${m.load15.toFixed(1)}`} />
            <CompactMetric label={t('perf.process', 'Proc')} value={String(m.cpu_count)} />
            <CompactMetric label="↑" value={fmtSpeed(m.net_up_speed)} />
            <CompactMetric label="↓" value={fmtSpeed(m.net_down_speed)} />
          </div>
        </div>

        {/* ── 3. Memory + Disk Detail ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <MemoryStick size={14} className="text-purple-400" />
              <span className="text-[11px] font-semibold text-aegis-text-muted uppercase tracking-wider">{t('perf.memory', '内存')}</span>
            </div>
            <div className="flex items-end justify-between mb-2">
              <span className="text-2xl font-bold text-aegis-text tabular-nums">{fmtBytes(m.mem_used)}</span>
              <span className="text-xs text-aegis-text-dim">/ {fmtBytes(m.mem_total)}</span>
            </div>
            <UsageBar value={memPct} />
          </div>
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive size={14} className="text-amber-400" />
              <span className="text-[11px] font-semibold text-aegis-text-muted uppercase tracking-wider">{t('perf.disk', '磁盘')}</span>
            </div>
            <div className="flex items-end justify-between mb-2">
              <span className="text-2xl font-bold text-aegis-text tabular-nums">{fmtBytes(m.disk_used)}</span>
              <span className="text-xs text-aegis-text-dim">/ {fmtBytes(m.disk_total)}</span>
            </div>
            <UsageBar value={diskPct} />
          </div>
        </div>

        {/* ── 4. Agent + Network ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={14} className="text-slate-400" />
              <span className="text-[11px] font-semibold text-aegis-text-muted uppercase tracking-wider">{t('perf.agentStatus', 'Agent 状态')}</span>
            </div>
            <div className="space-y-2">
              {agents.length === 0 ? (
                <p className="text-xs text-aegis-text-dim py-4 text-center">{t('perf.noAgents', '暂无 Agent')}</p>
              ) : agents.slice(0, 8).map(agent => {
                const active = sessions.some(s => s.key.includes(agent.id));
                return (
                  <div key={agent.id} className="flex items-center gap-2 text-xs">
                    <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', active ? 'bg-green-500' : 'bg-red-500/40')} />
                    <span className="text-aegis-text truncate flex-1">{agent.name || agent.id}</span>
                    {active ? (
                      <span className="text-green-400 text-[10px] font-mono">在线</span>
                    ) : (
                      <span className="text-aegis-text-dim text-[10px] font-mono">离线</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-aegis-border/40 bg-aegis-surface/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Network size={14} className="text-cyan-400" />
              <span className="text-[11px] font-semibold text-aegis-text-muted uppercase tracking-wider">{t('perf.network', '网络')}</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-aegis-text-dim flex items-center gap-1"><ArrowUp size={10} className="text-green-400" />{t('perf.upload', '上传')}</span>
                  <span className="font-mono tabular-nums text-aegis-text font-medium">{fmtSpeed(m.net_up_speed)}</span>
                </div>
                <UsageBar value={0} />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-aegis-text-dim flex items-center gap-1"><ArrowDown size={10} className="text-blue-400" />{t('perf.download', '下载')}</span>
                  <span className="font-mono tabular-nums text-aegis-text font-medium">{fmtSpeed(m.net_down_speed)}</span>
                </div>
                <UsageBar value={0} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Performance;
