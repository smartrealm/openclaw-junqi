// ─────────────────────────────────────────────────────────────────
// AgentOverviewPanel — kooky AgentOverviewSidebar 1:1 port.
//
// Two modes matching kooky's SidebarMode:
//   full    — header "agents" + count, scrollable rows with agent icon,
//            name, tab title, and state WORD (kooky AgentMonitor.State).
//   compact — 44px rail of tinted agent icons with 7px status dots
//            (bottom-right), hover tooltips.
//
// State precedence (kooky AgentMonitor.state): attention > failed >
// running > idle. The ended state (not in kooky's monitor) is mapped
// to idle — ended agents naturally drop off the monitor.
//
// Source: kooky Sources/KookyKit/App/AgentMonitor.swift (240 lines)
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type LifecycleState } from '@/components/shared/StatusBadge';
import { Icon } from '@/components/shared/icons';
import { useSessionHistoryStore } from '@/stores/sessionHistoryStore';

// ── Per-agent visual config (kooky AgentTemplate.tintHex + lucide icons) ───

function agentVisual(agent: string): { icon: React.ReactNode; tint: string; label: string } {
  return Icon.agent[agent] ?? { icon: Icon.agent.claude.icon, tint: '888888', label: agent || 'Agent' };
}

// ── Entry model ─────────────────────────────────────────────────────────────

export interface AgentMonitorEntry {
  sessionId: string;
  agent: string;
  state: LifecycleState;
  title: string;       // tab title (cwd basename or session-id prefix)
  projectPath?: string;
}

// ── State precedence (kooky AgentMonitor.state) ─────────────────────────────
const STATE_RANK: Record<LifecycleState, number> = {
  attention: 0,
  failed: 1,
  running: 2,
  ended: 3,
  idle: 4,
};

function worstState(a: LifecycleState, b: LifecycleState): LifecycleState {
  return STATE_RANK[a] <= STATE_RANK[b] ? a : b;
}

export type AgentPanelMode = 'full' | 'compact';

interface AgentOverviewPanelProps {
  projectPath: string;
  mode?: AgentPanelMode;
  onModeChange?: (mode: AgentPanelMode) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function AgentOverviewPanel({
  projectPath,
  mode = 'full',
  onModeChange,
}: AgentOverviewPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AgentMonitorEntry[]>([]);

  useEffect(() => {
    const poll = () => {
      invoke<string[]>('get_active_task_ids')
        .then((ids) => {
          const running: AgentMonitorEntry[] = ids.map((id) => ({
            sessionId: id,
            agent: 'unknown',
            state: 'running' as LifecycleState,
            title: id.slice(0, 8),
          }));
          setEntries(running);
        })
        .catch(() => {
          const store = useSessionHistoryStore.getState();
          const recent = Object.values(store.byKey)
            .filter((e) => e.projectPath === projectPath || store.recentByProject[projectPath]?.length)
            .slice(0, 8)
            .map((s) => ({
              sessionId: s.sessionId,
              agent: s.agent,
              state: 'ended' as LifecycleState,
              title: s.sessionId.slice(0, 8),
              projectPath: s.projectPath,
            }));
          setEntries(recent);
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [projectPath]);

  // ── Empty state (kooky: sparkles + "no agents running") ─────────────
  if (entries.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 7,
          opacity: 0.4,
          userSelect: 'none',
          padding: 20,
        }}
      >
        <Sparkles size={18} style={{ color: 'rgb(var(--aegis-text-dim))', opacity: 0.5 }} />
        <span style={{ fontSize: 11, color: 'rgb(var(--aegis-text-dim))' }}>
          {t('agent.empty', 'no agents running')}
        </span>
      </div>
    );
  }

  // ── Compact rail (kooky AgentOverviewSidebar.compactBody) ───────────
  if (mode === 'compact') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          padding: '8px 0',
          overflowY: 'auto',
          width: 44,
        }}
        role="list"
        aria-label="Active agents"
      >
        {entries.map((entry) => {
          const vis = agentVisual(entry.agent);
          return (
            <div
              key={entry.sessionId}
              role="listitem"
              title={`${vis.label} · ${entry.title} · ${entry.state}`}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                position: 'relative',
                color: `#${vis.tint}`,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {vis.icon}
              </span>
              {/* 7px status dot — kooky compact row overlay */}
              <span
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 2,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: `rgb(var(--aegis-status-${entry.state === 'ended' ? 'idle' : entry.state}))`,
                  boxShadow: entry.state === 'running'
                    ? '0 0 6px rgb(var(--aegis-status-running-glow))'
                    : 'none',
                  animation: entry.state === 'running'
                    ? 'aegis-pulse 1.6s ease-in-out infinite'
                    : 'none',
                }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // ── Full mode (kooky AgentOverviewSidebar.fullBody) ─────────────────
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      role="list"
      aria-label="Active agents"
    >
      {/* Header row — kooky: "agents" + count badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 14px',
          height: 32,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'rgb(var(--aegis-text))',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          agents
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: 'rgb(var(--aegis-text-dim))',
            background: 'rgb(var(--aegis-card))',
            borderRadius: 4,
            padding: '1px 6px',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {entries.length}
        </span>
        {/* Mode toggle — compact ↔ full */}
        {onModeChange && (
          <button
            onClick={() => onModeChange('compact')}
            title="Compact mode"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 4,
              color: 'rgb(var(--aegis-text-dim))',
              fontSize: 11,
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            [=]
          </button>
        )}
      </div>

      {/* 1px hairline — kooky chromeHairline */}
      <div style={{ height: 1, flexShrink: 0, background: 'rgb(255 255 255 / 0.07)' }} />

      {/* Scrollable agent rows */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {entries.map((entry) => {
          const vis = agentVisual(entry.agent);
          return (
            <div
              key={entry.sessionId}
              role="listitem"
              title={entry.projectPath ?? entry.sessionId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 14px',
                height: 46,
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgb(255 255 255 / 0.04)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {/* Agent icon — kooky AgentIconView (16px, tinted) */}
              <span
                style={{
                  width: 16,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: `#${vis.tint}`,
                }}
              >
                {vis.icon}
              </span>

              {/* Name + tab title column */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'rgb(var(--aegis-text))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  {vis.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'rgb(var(--aegis-text-dim))',
                    opacity: 0.75,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.title}
                </span>
              </div>

              {/* State word — kooky AgentOverviewRow state label */}
              <StatusBadge
                state={entry.state === 'ended' ? 'idle' : entry.state}
                label
                size={7}
                className="shrink-0"
              />
            </div>
          );
        })}
      </div>

      {/* Bottom: compact toggle hint */}
      {onModeChange && (
        <div
          style={{
            height: 28,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderTop: '1px solid rgb(255 255 255 / 0.07)',
          }}
        >
          <button
            onClick={() => onModeChange('compact')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 4,
              color: 'rgb(var(--aegis-text-dim))',
              fontSize: 9,
              fontFamily: '"JetBrains Mono", monospace',
              opacity: 0.5,
            }}
          >
            collapse
          </button>
        </div>
      )}
    </div>
  );
}
