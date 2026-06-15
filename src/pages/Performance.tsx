// Performance Monitor — Nezha-style server dashboard.
// Card-based metric layout with progress bars, matching nezha monitoring design.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Cpu, HardDrive, Clock, Wifi, WifiOff, Users, Bot, MessageSquare, Zap, RefreshCw, MemoryStick, Network, ArrowUp, ArrowDown } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import clsx from 'clsx';

function ProgressBar({ pct, color = 'bg-aegis-primary' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-[rgb(var(--aegis-overlay)/0.08)] overflow-hidden">
      <div className={clsx('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, pct, color = 'text-aegis-primary', barColor, children }: {
  icon: any; label: string; value: string; sub?: string; pct?: number; color?: string; barColor?: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-aegis-border/40 bg-aegis-surface/60 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-aegis-text-muted">{label}</span>
        <Icon size={16} className={clsx('shrink-0', color)} />
      </div>
      <div>
        <span className="text-[28px] font-bold text-aegis-text tabular-nums leading-none">{value}</span>
        {sub && <span className="text-[12px] text-aegis-text-dim ml-2">{sub}</span>}
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
  const [refreshKey, setRefreshKey] = useState(0);

  const measurePing = useCallback(async () => {
    const s = Date.now(); try { await gateway.getStatus(); setPing(Date.now() - s); } catch { setPing(null); }
  }, []);

  useEffect(() => { measurePing(); const i = setInterval(measurePing, 30000); return () => clearInterval(i); }, [measurePing, refreshKey]);

  const ctxTokens = tokenUsage?.contextTokens ?? 0;
  const maxTokens = tokenUsage?.maxTokens ?? 0;
  const ctxPct = maxTokens > 0 ? Math.round((ctxTokens / maxTokens) * 100) : 0;
  const agentCount = agents.length;
  const sessionCount = sessions.length;
  const activeCount = agents.filter(a => sessions.some(s => s.key.includes(a.id))).length;
  const modelCount = useChatStore(s => s.availableModels).length;

  // Simulated metrics for demo (real data would come from gateway snapshot)
  const cpuPct = Math.round(30 + Math.random() * 20);
  const memPct = Math.round(40 + Math.random() * 30);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-aegis-primary/10 flex items-center justify-center">
            <Activity size={16} className="text-aegis-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-aegis-text">{t('nav.performance', '性能监控')}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className="text-[10px] text-aegis-text-dim">{connected ? t('perf.online', '在线') : t('perf.offline', '离线')}</span>
              {ping && <span className="text-[10px] text-aegis-text-dim">{ping}ms</span>}
            </div>
          </div>
        </div>
        <button onClick={() => { measurePing(); setRefreshKey(k => k + 1); }} className="p-2 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
          <RefreshCw size={14} className="text-aegis-text-muted" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* ── System Metrics ── */}
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-dim mb-3">{t('perf.systemMetrics', '系统指标')}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard icon={Cpu} label="CPU" value={`${cpuPct}%`} pct={cpuPct} color="text-blue-400" barColor="bg-blue-500/70" />
            <MetricCard icon={MemoryStick} label={t('perf.memory', '内存')} value={`${memPct}%`} pct={memPct} color="text-purple-400" barColor="bg-purple-500/70" />
            <MetricCard icon={HardDrive} label={t('perf.disk', '磁盘')} value="—" sub={t('perf.comingSoon', '即将支持')} color="text-amber-400" />
            <MetricCard icon={Network} label={t('perf.network', '网络')} value="—" color="text-cyan-400">
              <div className="flex items-center gap-3 mt-1 text-[10px] text-aegis-text-dim">
                <span className="flex items-center gap-0.5"><ArrowUp size={10} className="text-emerald-400" />0 B/s</span>
                <span className="flex items-center gap-0.5"><ArrowDown size={10} className="text-blue-400" />0 B/s</span>
              </div>
            </MetricCard>
          </div>
        </div>

        {/* ── Gateway & Tokens ── */}
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-dim mb-3">Gateway</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard icon={Zap} label={t('perf.ctxUsage', '上下文')} value={`${ctxPct}%`} pct={ctxPct}
              sub={`${Math.round(ctxTokens / 1000)}K`} color="text-amber-400"
              barColor={ctxPct > 80 ? 'bg-red-500/70' : ctxPct > 60 ? 'bg-amber-500/70' : 'bg-emerald-500/70'} />
            <MetricCard icon={Clock} label={t('perf.compactions', '压缩')} value={String(tokenUsage?.compactions ?? 0)} color="text-slate-400" />
            <MetricCard icon={Bot} label={t('perf.agents', 'Agents')} value={String(agentCount)} color="text-blue-400" />
            <MetricCard icon={MessageSquare} label={t('perf.sessions', '会话')} value={String(sessionCount)} color="text-purple-400" />
          </div>
        </div>

        {/* ── Agent Status ── */}
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-dim mb-3">{t('perf.agentStatus', 'Agent 状态')}</h2>
          <div className="rounded-2xl border border-aegis-border/40 overflow-hidden">
            {agents.length === 0 ? (
              <div className="px-4 py-12 text-center text-[12px] text-aegis-text-dim">{t('perf.noAgents', '暂无 Agent')}</div>
            ) : (
              <div className="divide-y divide-aegis-border/20">
                {agents.map(agent => {
                  const active = sessions.some(s => s.key.includes(agent.id));
                  return (
                    <div key={agent.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[rgb(var(--aegis-overlay)/0.02)] transition-colors">
                      <div className={clsx('w-2.5 h-2.5 rounded-full shrink-0 ring-2', active ? 'bg-emerald-400 ring-emerald-400/20' : 'bg-aegis-text-dim/30 ring-aegis-text-dim/10')} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-aegis-text">{agent.name || agent.id}</div>
                        <div className="text-[10px] text-aegis-text-dim font-mono">{agent.id}</div>
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
    </div>
  );
}

export default Performance;
