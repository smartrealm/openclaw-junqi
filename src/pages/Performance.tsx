// Performance — system metrics, restyled to match the app's glass/aegis theme.
// Data from the Rust sysinfo background thread via the "system-metrics" stream.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, Cpu, MemoryStick, HardDrive, Network, Server, Users } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import type { SystemMetricsPayload } from '@/api/tauri-adapter';
import clsx from 'clsx';
import { GlassCard } from '@/components/shared/GlassCard';
import { themeHex } from '@/utils/theme-colors';
import { formatBytes } from '@/utils/format';

function fmtSpeed(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(2)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}
function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d} 天 ${h} 时` : h > 0 ? `${h} 时` : `${Math.floor(secs / 60)} 分`;
}
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** Themed usage bar: success → warning (>70%) → danger (>90%). */
function UsageBar({ value, label, icon, display }: { value: number; label: string; icon: React.ReactNode; display: string }) {
  const color = value > 90 ? themeHex('danger') : value > 70 ? themeHex('warning') : themeHex('success');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-aegis-text-dim">
          <span style={{ color: themeHex('primary') }}>{icon}</span>
          {label}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-aegis-text">{display}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[rgb(var(--aegis-overlay)/0.12)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${clampPct(value)}%`, background: color }} />
      </div>
    </div>
  );
}

function StatPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[rgb(var(--aegis-overlay)/0.04)] px-2.5 py-1.5">
      <p className="text-[10px] text-aegis-text-dim mb-0.5">{label}</p>
      <div className="text-[11px] text-aegis-text font-medium tabular-nums">{children}</div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span style={{ color: themeHex('primary') }}>{icon}</span>
      <h2 className="text-xs font-semibold text-aegis-text">{children}</h2>
    </div>
  );
}

function AgentStat({ label, value, color, pulse }: { label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <div className="rounded-lg bg-[rgb(var(--aegis-overlay)/0.04)] px-2 py-2 flex flex-col items-center gap-1">
      <span className={clsx('w-1.5 h-1.5 rounded-full', pulse && 'animate-pulse')} style={{ background: color }} />
      <span className="text-base font-bold tabular-nums text-aegis-text">{value}</span>
      <span className="text-[10px] text-aegis-text-dim text-center leading-tight">{label}</span>
    </div>
  );
}

export function Performance() {
  const { t } = useTranslation();
  const { connected, tokenUsage, sessions } = useChatStore();
  const agents = useGatewayDataStore((s) => s.agents);
  const [ping, setPing] = useState<number | null>(null);
  const [m, setM] = useState<SystemMetricsPayload>({
    cpu: 0, cpu_count: 0, mem_used: 0, mem_total: 0, disk_used: 0, disk_total: 0,
    net_up_speed: 0, net_down_speed: 0, uptime: 0, load1: 0, load5: 0, load15: 0,
    platform: '', platform_version: '', arch: '',
  });

  useEffect(() => {
    const unsub = (window.aegis as any)?.systemMetrics?.onMetrics?.((metrics: SystemMetricsPayload) => setM(metrics));
    return () => { unsub?.(); };
  }, []);

  const measurePing = useCallback(async () => {
    const s = Date.now();
    try { await gateway.getStatus(); setPing(Date.now() - s); } catch { setPing(null); }
  }, []);
  useEffect(() => { measurePing(); const i = setInterval(measurePing, 30000); return () => clearInterval(i); }, [measurePing]);

  const memPct = m.mem_total > 0 ? Math.round((m.mem_used / m.mem_total) * 100) : 0;
  const diskPct = m.disk_total > 0 ? Math.round((m.disk_used / m.disk_total) * 100) : 0;
  const onlineAgents = agents.filter((a) => sessions.some((s) => s.key.includes(a.id))).length;
  const offlineAgents = agents.length - onlineAgents;
  const ctxTokens = tokenUsage?.contextTokens ?? 0;
  const maxTokens = tokenUsage?.maxTokens ?? 0;
  const ctxPct = maxTokens > 0 ? Math.round((ctxTokens / maxTokens) * 100) : 0;

  const success = themeHex('success');
  const danger = themeHex('danger');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-aegis-border/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <Activity size={16} style={{ color: themeHex('primary') }} />
          <h1 className="text-sm font-bold text-aegis-text">{t('nav.performance', '准端')}</h1>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? success : danger }} />
          <span className="text-[10px] text-aegis-text-dim tabular-nums">{ping != null ? `${ping}ms` : '—'}</span>
        </div>
        <button
          onClick={measurePing}
          className="p-2 rounded-lg text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text transition-colors"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-5xl p-6 space-y-4">
          {/* 系统 */}
          <GlassCard hover={false} delay={0.02}>
            <SectionTitle icon={<Server size={14} />}>{t('perf.system', '系统')}</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <StatPill label={t('perf.status', '状态')}>
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? success : danger }} />
                  {connected ? t('perf.online', 'Online') : t('perf.offline', 'Offline')}
                </span>
              </StatPill>
              <StatPill label={t('perf.uptime', 'Uptime')}>{m.uptime > 0 ? fmtUptime(m.uptime) : '—'}</StatPill>
              <StatPill label={t('perf.version', 'Version')}>{m.platform_version || '—'}</StatPill>
              <StatPill label={t('perf.arch', 'Arch')}>{m.arch || '—'}</StatPill>
              <StatPill label="Memory">{formatBytes(m.mem_total)}</StatPill>
              <StatPill label="Disk">{formatBytes(m.disk_total)}</StatPill>
              <StatPill label="CPU">{m.cpu_count} cores</StatPill>
              <StatPill label="Load">{m.load1.toFixed(2)} / {m.load5.toFixed(2)} / {m.load15.toFixed(2)}</StatPill>
            </div>
          </GlassCard>

          {/* 资源使用 */}
          <GlassCard hover={false} delay={0.06}>
            <SectionTitle icon={<Cpu size={14} />}>{t('perf.resources', '资源使用')}</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <UsageBar value={m.cpu} label="CPU" icon={<Cpu size={12} />} display={`${m.cpu.toFixed(1)}%`} />
              <UsageBar value={memPct} label={t('perf.memory', '内存')} icon={<MemoryStick size={12} />} display={`${memPct}% · ${formatBytes(m.mem_used)}`} />
              <UsageBar value={diskPct} label="Disk" icon={<HardDrive size={12} />} display={`${diskPct}% · ${formatBytes(m.disk_used)}`} />
              <UsageBar value={ctxPct} label={t('perf.context', '上下文')} icon={<Activity size={12} />} display={`${ctxPct}%`} />
            </div>
          </GlassCard>

          {/* 网络 + Agents */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GlassCard hover={false} delay={0.1}>
              <SectionTitle icon={<Network size={14} />}>{t('perf.network', '网络')}</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2">
                  <p className="text-[10px] text-aegis-text-dim mb-0.5">{t('perf.upload', 'Upload')}</p>
                  <p className="text-sm font-semibold tabular-nums" style={{ color: themeHex('accent') }}>{fmtSpeed(m.net_up_speed)}</p>
                </div>
                <div className="rounded-lg bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2">
                  <p className="text-[10px] text-aegis-text-dim mb-0.5">{t('perf.download', 'Download')}</p>
                  <p className="text-sm font-semibold tabular-nums" style={{ color: themeHex('primary') }}>{fmtSpeed(m.net_down_speed)}</p>
                </div>
              </div>
            </GlassCard>

            <GlassCard hover={false} delay={0.14}>
              <SectionTitle icon={<Users size={14} />}>{t('perf.agents', 'Agents')}</SectionTitle>
              <div className="grid grid-cols-4 gap-2">
                <AgentStat label={t('perf.totalAgents', '总数')} value={agents.length} color={themeHex('primary')} />
                <AgentStat label={t('perf.activeAgents', '在线')} value={onlineAgents} color={success} pulse={onlineAgents > 0} />
                <AgentStat label={t('perf.offlineAgents', '离线')} value={offlineAgents} color={danger} />
                <AgentStat label={t('perf.sessions', '会话')} value={sessions.length} color={themeHex('accent')} />
              </div>
            </GlassCard>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Performance;
