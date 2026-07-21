// ─────────────────────────────────────────────────────────────────
// ToolCallHistoryPopover — kooky ToolCallActivityPill 1:1 port.
//
// Renders a compact tool-call pill (category counts + chevron) and,
// on click, a 520×360px history popover with:
//   - Header: per-category counter segments + session elapsed
//   - Scrollable event list (newest first): tool icon, name,
//     identifier (truncated), duration, state glyph (⋯/✓/✗/⊘)
//   - Empty / waiting states
//
// Source: kooky Sources/KookyKit/Terminal/ToolCallActivityStrip.swift (438 lines)
// ─────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  SquareTerminal, Pencil, FileText, Search, Globe,
  List, Box, Clock, ChevronDown, X,
} from 'lucide-react';
import { StatusIcon, type StatusIconValue } from './StatusIcon';

// ── Event model (kooky ToolCallEvent) ────────────────────────────────────────

export type ToolEventState = 'running' | 'done' | 'error' | 'aborted';

export interface ToolCallEvent {
  id: string;
  toolName: string;
  identifier: string;
  state: ToolEventState;
  startedAt: number;   // epoch ms
  endedAt?: number;     // epoch ms
  category: 'bash' | 'edit' | 'read' | 'other';
}

export interface ToolStats {
  bash: number;
  edit: number;
  read: number;
  other: number;
  latest: string;
}

// ── Tool icon mapper (kooky ToolCallActivityPill.toolIcon) ───────────────────

function toolIcon(name: string, size = 11): React.ReactNode {
  const key = name.toLowerCase();
  if (key.includes('bash')) return <SquareTerminal size={size} />;
  if (key.includes('edit') || key.includes('write') || key.includes('multiedit')) return <Pencil size={size} />;
  if (key.includes('read')) return <FileText size={size} />;
  if (key.includes('notebook')) return <FileText size={size} />;
  if (key.includes('grep') || key.includes('glob') || key.includes('find') || key.includes('search')) return <Search size={size} />;
  if (key.includes('web') || key.includes('fetch')) return <Globe size={size} />;
  if (key.includes('list') || key.includes('ls')) return <List size={size} />;
  return <Box size={size} />;
}

function classifyCategory(name: string): ToolCallEvent['category'] {
  const key = name.toLowerCase();
  if (key.includes('bash')) return 'bash';
  if (key.includes('edit') || key.includes('write') || key.includes('multiedit')) return 'edit';
  if (key.includes('read') || key.includes('notebook')) return 'read';
  return 'other';
}

// ── Duration formatting (kooky ToolCallActivityPill.formatElapsed) ───────────

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 1) return `${(ms / 1000).toFixed(1)}s`;
  if (total < 60) return `${total}s`;
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (total < 3600) return `${mins}:${String(secs).padStart(2, '0')}`;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ── Live duration text (kooky LiveDurationText) ──────────────────────────────

function LiveDurationText({ startTime, isRunning }: { startTime: number; isRunning: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);
  const ms = isRunning ? Date.now() - startTime : 0;
  return <>{formatElapsed(isRunning ? ms : 0)}</>;
}

function DurationLabel({ event }: { event: ToolCallEvent }) {
  const elapsed = event.endedAt
    ? event.endedAt - event.startedAt
    : event.state === 'running'
      ? Date.now() - event.startedAt
      : 0;
  if (event.state === 'running') return <LiveDurationText startTime={event.startedAt} isRunning />;
  return <>{formatElapsed(elapsed)}</>;
}

// ── State presentation ──────────────────────────────────────────────────────

const STATE_PRESENTATION: Record<ToolEventState, { icon: StatusIconValue; color: string }> = {
  running:  { icon: 'running', color: 'rgb(var(--aegis-status-running))' },
  done:     { icon: 'done', color: 'rgb(var(--aegis-success))' },
  error:    { icon: 'error', color: 'rgb(var(--aegis-status-failed))' },
  aborted:  { icon: 'cancelled', color: 'rgb(var(--aegis-text-dim))' },
};

// ── Category colors ─────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  bash:  'rgb(var(--aegis-warning))',
  edit:  'rgb(var(--aegis-primary))',
  read:  'rgb(var(--aegis-text-secondary))',
  other: 'rgb(var(--aegis-text-dim))',
};

// ── Pill sub-component ──────────────────────────────────────────────────────

interface PillProps {
  stats: ToolStats;
  isOpen: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

const CompactPill = React.forwardRef<HTMLButtonElement, Omit<PillProps, 'ref'>>(
  function CompactPill({ stats, isOpen, onClick }, ref) {
  const total = stats.bash + stats.edit + stats.read + stats.other;
  if (total === 0) return null;

  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        border: '1px solid rgb(255 255 255 / 0.08)',
        background: isOpen ? 'rgb(var(--aegis-overlay)/0.08)' : 'transparent',
        cursor: 'pointer',
        color: 'rgb(var(--aegis-text-dim))',
        fontSize: 10,
        fontFamily: '"JetBrains Mono", monospace',
        transition: 'background 0.1s',
        whiteSpace: 'nowrap',
      }}
      title="View tool call history"
    >
      {stats.bash > 0 && <span style={{ color: CAT_COLORS.bash, display: 'inline-flex', alignItems: 'center', gap: 1 }}><SquareTerminal size={9} />{stats.bash}</span>}
      {stats.edit > 0 && <span style={{ color: CAT_COLORS.edit, display: 'inline-flex', alignItems: 'center', gap: 1 }}><Pencil size={9} />{stats.edit}</span>}
      {stats.read > 0 && <span style={{ color: CAT_COLORS.read, display: 'inline-flex', alignItems: 'center', gap: 1 }}><FileText size={9} />{stats.read}</span>}
      {stats.other > 0 && <span style={{ color: CAT_COLORS.other, display: 'inline-flex', alignItems: 'center', gap: 1 }}><Box size={9} />{stats.other}</span>}
      <ChevronDown size={9} style={{ opacity: 0.5 }} />
    </button>
  );
});

// ── Popover sub-components ──────────────────────────────────────────────────

interface PopoverProps {
  events: ToolCallEvent[];
  stats: ToolStats;
  sessionStartedAt: number;
  onClose: () => void;
}

function CounterSegment({ icon: iconName, count, label }: { icon: string; count: number; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color: 'rgb(var(--aegis-text-dim))' }}>{toolIcon(iconName, 11)}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'rgb(var(--aegis-text))', fontFamily: '"JetBrains Mono", monospace' }}>{count}</span>
      <span style={{ fontSize: 10, color: 'rgb(var(--aegis-text-dim))' }}>{label}</span>
    </span>
  );
}

function ToolCallHistoryPopoverContent({ events, stats, sessionStartedAt, onClose }: PopoverProps) {
  // Session elapsed (kooky: from oldest event to now, or to latest completed)
  const sessionElapsed = events.length > 0
    ? (() => {
        const start = events[events.length - 1]?.startedAt ?? Date.now();
        const hasRunning = events.some((e) => e.state === 'running');
        const end = hasRunning ? Date.now() : events.reduce((max, e) => Math.max(max, e.endedAt ?? e.startedAt), 0);
        return end - start;
      })()
    : 0;

  return (
    <div
      style={{
        width: 520,
        height: 360,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgb(var(--aegis-elevated))',
        color: 'rgb(var(--aegis-text))',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 16px 48px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.06)',
      }}
    >
      {/* Header (kooky ToolCallHistoryPopover.header) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          flexShrink: 0,
        }}
      >
        <CounterSegment icon="bash" count={stats.bash} label="Bash" />
        <CounterSegment icon="edit" count={stats.edit} label="Edit" />
        <CounterSegment icon="read" count={stats.read} label="Read" />
        {stats.other > 0 && <CounterSegment icon="other" count={stats.other} label="Other" />}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Clock size={11} style={{ color: 'rgb(var(--aegis-text-dim))' }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'rgb(var(--aegis-text))', fontFamily: '"JetBrains Mono", monospace' }}>
            {formatElapsed(sessionElapsed)}
          </span>
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            borderRadius: 4,
            color: 'rgb(var(--aegis-text-dim))',
            display: 'flex',
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* 1px hairline */}
      <div style={{ height: 1, flexShrink: 0, background: 'rgb(255 255 255 / 0.07)' }} />

      {/* Scrollable event list (newest first) */}
      {events.length === 0 ? (
        <EmptyOrWaiting stats={stats} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {[...events].reverse().map((event, idx) => (
            <div key={event.id}>
              <EventRow event={event} />
              {idx < events.length - 1 && (
                <div style={{ height: 1, background: 'rgb(255 255 255 / 0.04)', margin: '0 14px' }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyOrWaiting({ stats }: { stats: ToolStats }) {
  const total = stats.bash + stats.edit + stats.read + stats.other;
  if (total > 0) {
    // Waiting: counts received but no individual events (transitional state)
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: 0.4,
        }}
      >
        <Clock size={20} style={{ opacity: 0.3 }} />
        <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-dim))' }}>
          waiting for tool calls
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: 0.4,
      }}
    >
      <Clock size={20} style={{ opacity: 0.3 }} />
      <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-dim))' }}>
        No tool calls recorded.
      </span>
    </div>
  );
}

function EventRow({ event }: { event: ToolCallEvent }) {
  const pres = STATE_PRESENTATION[event.state];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 14px',
        height: 32,
        fontFamily: '"JetBrains Mono", monospace',
      }}
    >
      {/* Category icon */}
      <span style={{ width: 14, flexShrink: 0, display: 'flex', justifyContent: 'center', color: 'rgb(var(--aegis-text-dim))' }}>
        {toolIcon(event.toolName, 11)}
      </span>

      {/* Tool name */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          width: 64,
          flexShrink: 0,
          color: pres.color,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}
      >
        {event.toolName}
      </span>

      {/* Identifier */}
      <span
        style={{
          fontSize: 11,
          flex: 1,
          minWidth: 0,
          color: pres.color,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {event.identifier || '—'}
      </span>

      {/* Duration */}
      <span
        style={{
          fontSize: 11,
          width: 56,
          flexShrink: 0,
          textAlign: 'right',
          color: pres.color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <DurationLabel event={event} />
      </span>

      {/* State */}
      <span
        style={{
          width: 14,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <StatusIcon status={pres.icon} size={12} />
      </span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface ToolCallHistoryPopoverProps {
  stats: ToolStats;
  events: ToolCallEvent[];
  sessionStartedAt: number;
  className?: string;
}

export function ToolCallActivityPill({ stats, events, sessionStartedAt, className }: ToolCallHistoryPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
      pillRef.current && !pillRef.current.contains(e.target as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen, handleOutsideClick]);

  // Escape key dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const total = stats.bash + stats.edit + stats.read + stats.other;
  if (total === 0) return null;

  return (
    <span className={className} style={{ position: 'relative', display: 'inline-flex' }}>
      <CompactPill
        ref={pillRef}
        stats={stats}
        isOpen={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      />

      {isOpen && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: pillRef.current
              ? pillRef.current.getBoundingClientRect().bottom + 6
              : '50%',
            right: pillRef.current
              ? window.innerWidth - pillRef.current.getBoundingClientRect().right
              : 'auto',
            zIndex: 100,
          }}
        >
          <ToolCallHistoryPopoverContent
            events={events}
            stats={stats}
            sessionStartedAt={sessionStartedAt}
            onClose={() => setIsOpen(false)}
          />
        </div>
      )}
    </span>
  );
}

export default ToolCallActivityPill;
