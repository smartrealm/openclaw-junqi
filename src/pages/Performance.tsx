// Performance Monitor — Nezha-style system metrics dashboard.
// Data from Rust background thread (sysinfo) via Tauri event stream.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Cpu, HardDrive, Clock, Wifi, WifiOff, Bot, MessageSquare, Zap, RefreshCw, MemoryStick, Network, ArrowUp, ArrowDown } from 'lucide-react';
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

function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-2.5 rounded-full bg-[rgb(var(--aegis-overlay)/0.08)] overflow-hidden">
      <div className={clsx('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, pct, color = 'text-aegis-primary', barColor, children }: {
  icon: any; label: string; value: string; sub?: string; pct?: number; color?: string; barColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-aegis-border/40 bg-aegis-surface/60 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-aegis-text-muted">{label}</span>
        <Icon size={17} className={clsx('shrink-0', color)} />
      </div>
      <div>
        <span className="text-3xl font-bold text-aegis-text tabular-nums leading-none">{value}</span>
        {sub && <span className="text-xs text-aegis-text-dim ml-2">{sub}</span>}
      </div>
      {pct !== undefined && <ProgressBar pct={pct} color={barColor || 'bg-aegis-primary'} />}
      {children}
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

  const ctxTokens = tokenUsage?.contextTokens ?? 0;
  const maxTokens = tokenUsage?.maxTokens ?? 0;
  const ctxPct = maxTokens > 0 ? Math.round((ctxTokens / maxTokens) * 100) : 0;
  const memPct = m.mem_total > 0 ? Math.round((m.mem_used / m.mem_total) * 100) : 0;
  const diskPct = m.disk_total > 0 ? Math.round((m.disk_used / m.disk_total) * 100) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border/50 shrink-0">
        <div>
          <h1 className="text-sm font-bold text-aegis-text">{t('nav.performance', '性能监控')}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-red-400')} />
            <span className="text-[10px] text-aegis-text-dim">{connected ? t('perf.online', '在线') : t('perf.offline', '离线')}</span>
            {ping && <span className="text-[10px] text-aegis-text-dim">{ping}ms</span>}
            {m.platform && <span className="text-[10px] text-aegis-text-dim">{m.platform} {m.platform_version} · {m.arch}</span>}
            {m.uptime > 0 && <span className="text-[10px] text-aegis-text-dim">{t('perf.uptime', '运行')}: {fmtUptime(m.uptime)}</span>}
          </div>
        </div>
        <button onClick={measurePing} className="p-2 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
          <RefreshCw size={14} className="text-aegis-text-muted" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* System Metrics */}
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-dim">{t('perf.systemMetrics', '系统指标')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Cpu} label="CPU" value={`${m.cpu}%`} pct={m.cpu} color="text-blue-400" barColor="bg-blue-500/70">
            <div className="text-[10px] text-aegis-text-dim mt-0.5">
              Load: {m.load1.toFixed(1)} / {m.load5.toFixed(1)} / {m.load15.toFixed(1)} · {m.cpu_count} cores
            </div>
          </MetricCard>
          <MetricCard icon={MemoryStick} label={t('perf.memory', '内存')} value={`${memPct}%`} pct={memPct}
            sub={`${fmtBytes(m.mem_used)} / ${fmtBytes(m.mem_total)}`} color="text-purple-400" barColor="bg-purple-500/70" />
          <MetricCard icon={HardDrive} label={t('perf.disk', '磁盘')} value={`${diskPct}%`} pct={diskPct}
            sub={`${fmtBytes(m.disk_used)} / ${fmtBytes(m.disk_total)}`} color="text-amber-400" barColor="bg-amber-500/70" />
          <MetricCard icon={Network} label={t('perf.network', '网络')} value="" color="text-cyan-400">
            <div className="flex flex-col gap-1 mt-0.5">
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
                <ArrowUp size={11} />{fmtSpeed(m.net_up_speed)}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-blue-400 font-mono">
                <ArrowDown size={11} />{fmtSpeed(m.net_down_speed)}
              </span>
            </div>
          </MetricCard>
        </div>

        {/* Gateway */}
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-dim">Gateway</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Zap} label={t('perf.ctxUsage', '上下文')} value={`${ctxPct}%`} pct={ctxPct}
            sub={`${Math.round(ctxTokens / 1000)}K`} color="text-amber-400"
            barColor={ctxPct > 80 ? 'bg-red-500/70' : ctxPct > 60 ? 'bg-amber-500/70' : 'bg-emerald-500/70'} />
          <MetricCard icon={Clock} label={t('perf.compactions', '压缩')} value={String(tokenUsage?.compactions ?? 0)} color="text-slate-400" />
          <MetricCard icon={Bot} label={t('perf.agents', 'Agents')} value={String(agents.length)} color="text-blue-400" />
          <MetricCard icon={MessageSquare} label={t('perf.sessions', '会话')} value={String(sessions.length)} color="text-purple-400" />
        </div>

        {/* Agent list */}
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-dim">{t('perf.agentStatus', 'Agent 状态')}</h2>
        <div className="rounded-2xl border border-aegis-border/40 overflow-hidden">
          {agents.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-aegis-text-dim">{t('perf.noAgents', '暂无 Agent')}</div>
          ) : (
            <div className="divide-y divide-aegis-border/20">
              {agents.map(agent => {
                const active = sessions.some(s => s.key.includes(agent.id));
                return (
                  <div key={agent.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[rgb(var(--aegis-overlay)/0.02)]">
                    <div className={clsx('w-2.5 h-2.5 rounded-full ring-2', active ? 'bg-emerald-400 ring-emerald-400/20' : 'bg-aegis-text-dim/30 ring-aegis-text-dim/10')} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-aegis-text">{agent.name || agent.id}</span>
                      <span className="text-[10px] text-aegis-text-dim font-mono ml-2">{agent.id}</span>
                    </div>
                    <span className={clsx('text-[10px] font-mono', active ? 'text-emerald-400' : 'text-aegis-text-dim')}>
                      {active ? '● ' + t('perf.online', '在线') : '○ ' + t('perf.offline', '离线')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Performance;
