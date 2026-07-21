import { useSyncExternalStore, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/shared/icons';
import { KookyAgentIcon, hasKookyAgentIcon } from './KookyAgentIcon';
import {
  getTerminalAgentOverviewSnapshot,
  subscribeTerminalAgentOverview,
  type TerminalAgentOverviewEntry,
  type TerminalAgentPanelMode,
} from './terminalAgentRegistry';

function agentVisual(agent: string, iconSize = 16): { icon: ReactNode; tint: string; label: string } {
  const fallback = Icon.agent[agent] ?? { icon: Icon.agent.claude.icon, tint: '888888', label: agent || 'Agent' };
  return {
    ...fallback,
    icon: hasKookyAgentIcon(agent) ? <KookyAgentIcon agent={agent} size={iconSize} /> : fallback.icon,
  };
}

function agentStateVisual(state: TerminalAgentOverviewEntry['state']): { label: string; color: string } {
  return state === 'attention'
    ? { label: 'waiting', color: 'rgb(var(--aegis-status-attention))' }
    : { label: 'running', color: 'rgb(var(--aegis-status-running))' };
}

export type AgentPanelMode = Exclude<TerminalAgentPanelMode, 'hidden'>;
/** Backward-compatible public alias for consumers of the terminal barrel. */
export type AgentMonitorEntry = TerminalAgentOverviewEntry;

interface AgentOverviewPanelProps {
  mode?: AgentPanelMode;
}

/** Kooky-style monitor backed by real terminal hook state, not task-history guesses. */
export function AgentOverviewPanel({ mode = 'full' }: AgentOverviewPanelProps) {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(
    subscribeTerminalAgentOverview,
    getTerminalAgentOverviewSnapshot,
    getTerminalAgentOverviewSnapshot,
  );

  if (mode === 'compact') {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0', overflowY: 'auto', width: 44 }}
        role="list"
        aria-label={t('terminal.agents', 'Agents')}
      >
        {entries.map((entry) => {
          const visual = agentVisual(entry.agent, 17);
          const state = agentStateVisual(entry.state);
          return (
            <button
              key={entry.shellId}
              type="button"
              role="listitem"
              title={`${visual.label} · ${entry.title} · ${state.label}`}
              aria-label={`${visual.label}: ${entry.title}`}
              onClick={entry.focus}
              style={{
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 6, position: 'relative', color: `#${visual.tint}`,
                background: 'transparent', cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay) / 0.08)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{visual.icon}</span>
              <span
                style={{
                  position: 'absolute', bottom: 2, right: 2, width: 7, height: 7, borderRadius: '50%',
                  background: state.color,
                  boxShadow: '0 0 0 1.5px var(--kooky-chrome)',
                }}
              />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }} role="list" aria-label={t('terminal.agents', 'Agents')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', height: 32, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--aegis-text))', fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace' }}>
          {t('terminal.agents', 'agents')}
        </span>
        {entries.length > 0 && <span style={{ fontSize: 10, fontWeight: 500, color: 'rgb(var(--aegis-text-dim))', fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace' }}>{entries.length}</span>}
      </div>
      <div style={{ height: 1, flexShrink: 0, background: 'rgb(255 255 255 / 0.07)' }} />
      {entries.length === 0 ? (
        <>
          <div style={{ height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, flexShrink: 0, userSelect: 'none' }}>
            <Sparkles size={18} strokeWidth={1.3} style={{ color: 'rgb(var(--aegis-text-dim))', opacity: 0.4 }} />
            <span style={{ fontSize: 11, color: 'rgb(var(--aegis-text-dim))', fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace' }}>
              {t('terminal.agentPanelEmpty', 'no agents running')}
            </span>
          </div>
          <div style={{ flex: 1 }} />
        </>
      ) : (
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {entries.map((entry) => {
          const visual = agentVisual(entry.agent);
          const state = agentStateVisual(entry.state);
          return (
            <button
              key={entry.shellId}
              type="button"
              role="listitem"
              title={`${visual.label} · ${entry.title} · ${state.label}`}
              onClick={entry.focus}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 46,
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay) / 0.07)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: `#${visual.tint}` }}>
                {visual.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--aegis-text))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace' }}>
                  {visual.label}
                </span>
                <span style={{ fontSize: 10, color: 'rgb(var(--aegis-text-dim))', opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace' }}>
                  {entry.title}
                </span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 500, color: state.color, fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace' }}>
                {state.label}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
