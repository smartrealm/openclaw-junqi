// Performance Monitor — gateway runtime metrics dashboard.
// Data from WS snapshot + chat store + gateway data store.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Cpu, HardDrive, Clock, Wifi, WifiOff, Users, Bot, MessageSquare, Zap, RefreshCw } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import clsx from 'clsx';

function StatCard({ icon: Icon, label, value, sub, color = 'text-aegis-primary' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-xl border border-aegis-border/50 bg-aegis-surface/50 p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <Icon size={15} className={clsx('shrink-0', color)} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-aegis-text-muted">{label}</span>
      </div>
      <div className="text-2xl font-bold text-aegis-text tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-aegis-text-dim mt-1">{sub}</div>}
    </div>
  );
}

export function Performance() {
  const { t } = useTranslation();
  const { connected, tokenUsage, sessions, activeSessionKey } = useChatStore();
  const agents = useGatewayDataStore(s => s.agents);
  const [ping, setPing] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const measurePing = useCallback(async () => {
    const start = Date.now();
    try {
      await gateway.getStatus();
      setPing(Date.now() - start);
    } catch { setPing(null); }
  }, []);

  useEffect(() => {
    measurePing();
    const i = setInterval(measurePing, 30000);
    return () => clearInterval(i);
  }, [measurePing, refreshKey]);

  const ctxTokens = tokenUsage?.contextTokens ?? 0;
  const maxTokens = tokenUsage?.maxTokens ?? 0;
  const ctxPct = maxTokens > 0 ? Math.round((ctxTokens / maxTokens) * 100) : 0;
  const sessionCount = sessions.length;
  const agentCount = agents.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-aegis-primary/10 flex items-center justify-center">
            <Activity size={15} className="text-aegis-primary" />
          </div>
          <h1 className="text-sm font-bold text-aegis-text">{t('nav.performance', '性能监控')}</h1>
        </div>
        <button onClick={() => { measurePing(); setRefreshKey(k => k + 1); }} className="p-1.5 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
          <RefreshCw size={14} className="text-aegis-text-muted" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Connection Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon={connected ? Wifi : WifiOff} label="Gateway"
            value={connected ? '在线' : '离线'}
            color={connected ? 'text-emerald-400' : 'text-red-400'}
            sub={ping ? `延迟 ${ping}ms` : undefined}
          />
          <StatCard icon={Clock} label="运行时间"
            value="—" sub="等待 Gateway 上报"
          />
          <StatCard icon={Cpu} label="占用上下文"
            value={`${ctxPct}%`}
            sub={`${Math.round(ctxTokens / 1000)}K / ${maxTokens >= 1000 ? `${Math.round(maxTokens / 1000)}K` : maxTokens}`}
          />
          <StatCard icon={Zap} label="压缩次数"
            value={tokenUsage?.compactions ?? 0}
          />
        </div>

        {/* Entities */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard icon={Bot} label="Agents" value={agentCount} color="text-blue-400" />
          <StatCard icon={MessageSquare} label="会话" value={sessionCount} color="text-purple-400" />
          <StatCard icon={Users} label="活跃 Agent"
            value={agents.filter(a => sessions.some(s => s.key.includes(a.id))).length}
            color="text-amber-400"
          />
          <StatCard icon={HardDrive} label="模型数"
            value={useChatStore(s => s.availableModels).length}
            color="text-cyan-400"
          />
        </div>

        {/* Agent List */}
        <div className="rounded-xl border border-aegis-border/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-aegis-border/30 bg-aegis-surface/30">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-aegis-text-muted">Agent 列表</h3>
          </div>
          <div className="divide-y divide-aegis-border/20">
            {agents.length === 0 && (
              <div className="px-4 py-8 text-center text-[12px] text-aegis-text-dim">暂无 Agent</div>
            )}
            {agents.map(agent => {
              const agentSessions = sessions.filter(s => s.key.includes(agent.id));
              return (
                <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[rgb(var(--aegis-overlay)/0.02)] transition-colors">
                  <div className={clsx('w-2 h-2 rounded-full shrink-0', agentSessions.length > 0 ? 'bg-emerald-400' : 'bg-aegis-text-dim/30')} />
                  <span className="flex-1 text-[12px] text-aegis-text font-medium">{agent.name || agent.id}</span>
                  <span className="text-[10px] text-aegis-text-muted font-mono">{agent.id}</span>
                  <span className="text-[10px] text-aegis-text-dim">{agentSessions.length} 会话</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Performance;
