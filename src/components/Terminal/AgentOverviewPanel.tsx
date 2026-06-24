// ─────────────────────────────────────────────────────────────────
// AgentOverviewPanel — kooky AgentOverviewSidebar port.
//
// Displays all active agent sessions in the workspace. Each row shows
// the agent icon, name, tab title, and a kooky-style status badge
// (running/attention/failed/idle/ended). Empty state is a sparkles
// icon with "no agents running".
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, Terminal, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusDot, type LifecycleState } from '@/components/shared/StatusBadge';
import { useSessionHistoryStore } from '@/stores/sessionHistoryStore';

interface AgentEntry {
  sessionId: string;
  agent: string;
  state: LifecycleState;
  label: string;
  projectPath?: string;
}

interface AgentOverviewPanelProps {
  projectPath: string;
}

export function AgentOverviewPanel({ projectPath }: AgentOverviewPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AgentEntry[]>([]);
  useEffect(() => {
    // Poll for active task IDs — if any, we show them as "running".
    const poll = () => {
      invoke<string[]>('get_active_task_ids')
        .then((ids) => {
          const running: AgentEntry[] = ids.map((id) => ({
            sessionId: id,
            agent: 'unknown',
            state: 'running' as LifecycleState,
            label: `Task ${id.slice(0, 8)}`,
          }));
          setEntries(running);
        })
        .catch(() => {
          // backend not available → show session history instead.
          // Access store directly (no selector) to avoid Object.values()
          // returning a fresh array ref on every tick → React #185.
          const store = useSessionHistoryStore.getState();
          const recent = Object.values(store.byKey)
            .filter((e) => e.projectPath === projectPath || store.recentByProject[e.projectPath]?.length)
            .slice(0, 8)
            .map((s) => ({ sessionId: s.sessionId, agent: s.agent, state: 'ended' as LifecycleState, label: s.sessionId.slice(0, 8), projectPath: s.projectPath }));
          setEntries(recent);
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [projectPath]);

  const agentIcon = (agent: string) => {
    if (agent === 'claude') return <span className="text-[14px]">✦</span>;
    if (agent === 'codex') return <Bot size={14} />;
    if (agent === 'pi') return <span className="text-[14px] font-bold">π</span>;
    return <Terminal size={14} />;
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40 select-none">
        <Sparkles size={28} className="text-aegis-text-dim" />
        <span className="text-[11px] text-aegis-text-dim">{t('agent.empty', 'No agents running')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" role="list" aria-label="Active agents">
      {entries.map((entry) => (
        <div
          key={entry.sessionId}
          role="listitem"
          className="flex items-center gap-2.5 px-3 py-2.5 cursor-default hover:bg-[rgb(var(--aegis-overlay)/0.04)] transition-colors border-b border-aegis-border/50"
          title={entry.projectPath ?? entry.sessionId}
        >
          <span className="shrink-0 w-5 flex items-center justify-center text-aegis-text-muted">
            {agentIcon(entry.agent)}
          </span>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[12px] font-medium text-aegis-text truncate">
              {entry.agent === 'unknown' ? 'Agent' : entry.agent}
            </span>
            <span className="text-[10px] text-aegis-text-dim truncate">{entry.label}</span>
          </div>
          <StatusDot state={entry.state} size={6} />
        </div>
      ))}
    </div>
  );
}