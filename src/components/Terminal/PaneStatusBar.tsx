// kooky PaneStatusBar 1:1 port — bottom status bar (32px)
// Layout mirrors kooky exactly:
//   LEFT:  [ZoomButton] [ComposerToggle]
//   RIGHT: FlowLayout { EnvPills · GitBranchSlot · GitDiffSlot }
//
// Data sources: git_diff_shortstat / get_terminal_env / git_list_branches (Tauri IPC).

import React, { useEffect, useState, useRef, useCallback } from "react";
import { APP_PLATFORM } from "./platform";
import { invoke } from "@tauri-apps/api/core";
import { debugError } from "@/utils/debugLog";
import { Bot, Server, Wrench } from 'lucide-react';
import { formatTerminalToolDuration, type ShellProxyInfo, type TerminalAgentActivity, type TerminalToolCall } from './shellLifecycle';

// ── Shared pill style (kooky StatusSegment / bracket-bordered pill) ───────
const pillBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "0 7px",
  height: 22,
  borderRadius: 4,
  fontSize: 11,
  fontFamily: '"JetBrains Mono", monospace',
  color: "rgb(var(--aegis-text-dim))",
  background: "transparent",
  border: "1px solid rgb(255 255 255 / 0.07)",
  cursor: "pointer",
  transition: "background 0.12s, border-color 0.12s",
  whiteSpace: "nowrap" as const,
  lineHeight: "1" as const,
};

function usePillHover() {
  const [hovered, setHovered] = useState(false);
  const activeStyle = { background: "rgb(var(--aegis-overlay)/0.08)", borderColor: "rgb(var(--aegis-overlay)/0.16)" };
  const idleStyle   = { background: "transparent", borderColor: "rgb(var(--aegis-overlay)/0.08)" };
  return {
    hovered,
    handlers: { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
    style: hovered ? activeStyle : idleStyle,
  };
}

// ── StatusBarIconButton (kooky StatusBarIconButton) ───────────────────────
function StatusBarIconButton({
  children, isActive, help, onClick,
}: { children: React.ReactNode; isActive?: boolean; help: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const bg     = isActive ? "rgb(var(--aegis-primary)/0.15)" : hovered ? "rgb(var(--aegis-overlay)/0.08)" : "transparent";
  const border = isActive ? "1px solid rgb(var(--aegis-primary)/0.3)" : hovered ? "1px solid rgb(var(--aegis-overlay)/0.16)" : "1px solid rgb(var(--aegis-overlay)/0.08)";
  const color  = isActive ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-dim))";
  return (
    <button onClick={onClick} title={help}
      style={{ ...pillBase, background: bg, border, color, width: 28, padding: "0 4px", justifyContent: "center" }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

// ── GitBranchSlot ─────────────────────────────────────────────────────────
function GitBranchSlot({ projectPath }: { projectPath: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pill = usePillHover();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      invoke<{ name: string; current: boolean }[]>("git_list_branches", { projectPath })
        .then((list) => {
          if (cancelled) return;
          setBranch(list.find((item) => item.current)?.name ?? null);
        })
        .catch(() => { if (!cancelled) setBranch(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 8_000);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [projectPath]);

  const handleToggle = useCallback(() => {
    if (popoverOpen) { setPopoverOpen(false); return; }
    invoke<{ name: string; current: boolean }[]>("git_list_branches", { projectPath })
      .then((list) => { setBranches(list.map((b) => b.name)); setPopoverOpen(true); })
      .catch(() => {});
  }, [popoverOpen, projectPath]);

  useEffect(() => {
    if (!popoverOpen) return;
    const h = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setPopoverOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [popoverOpen]);

  const handleCheckout = useCallback((b: string) => {
    setPopoverOpen(false);
    invoke("git_checkout_branch", { projectPath, branchName: b, isRemote: b.includes('/') })
      .then(() => setBranch(b))
      .catch((err) => debugError("terminal", "checkout failed:", err));
  }, [projectPath]);

  if (!branch) return null;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button onClick={handleToggle} style={{ ...pillBase, ...pill.style }} {...pill.handlers}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.65, flexShrink: 0 }}>
          <line x1="6" y1="3" x2="6" y2="15"/>
          <circle cx="18" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        {branch}
      </button>
      {popoverOpen && (
        <div style={{
          position: "absolute", bottom: 30, left: 0, zIndex: 200,
          minWidth: 160, maxHeight: 240, overflowY: "auto",
          background: "rgb(var(--aegis-elevated))",
          border: "1px solid rgb(255 255 255 / 0.08)",
          borderRadius: 6, boxShadow: "0 8px 24px rgb(0 0 0 / 0.4)",
          padding: "4px 0",
        }}>
          {branches.map((b) => (
            <div key={b} onClick={() => handleCheckout(b)}
              style={{
                padding: "5px 12px", fontSize: 11,
                fontFamily: '"JetBrains Mono", monospace',
                color: b === branch ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text))",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: b === branch ? "rgb(var(--aegis-overlay)/0.08)" : "transparent",
              }}
              onMouseEnter={(e) => { if (b !== branch) (e.currentTarget as HTMLElement).style.background = "rgb(var(--aegis-overlay)/0.06)"; }}
              onMouseLeave={(e) => { if (b !== branch) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {b === branch && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgb(var(--aegis-primary))", display: "inline-block", flexShrink: 0 }} />}
              {b}
            </div>
          ))}
          {branches.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "rgb(var(--aegis-text-dim))", fontFamily: '"JetBrains Mono", monospace' }}>No branches</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GitDiffSlot ───────────────────────────────────────────────────────────
// kooky diffSegment: filesChanged(muted) · +insertions(green) · -deletions(red)
interface GitDiffSummary { files_changed: number; insertions: number; deletions: number; }

function GitDiffSlot({ projectPath }: { projectPath: string }) {
  const [stat, setStat] = useState<GitDiffSummary | null>(null);
  const pill = usePillHover();

  useEffect(() => {
    let cancelled = false;
    const fetchDiff = () => {
      invoke<GitDiffSummary>("git_diff_shortstat", { projectPath })
        .then((s) => { if (!cancelled) setStat(s); })
        .catch(() => {});
    };
    fetchDiff();
    const timerId = window.setInterval(fetchDiff, 30_000);
    window.addEventListener('focus', fetchDiff);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
      window.removeEventListener('focus', fetchDiff);
    };
  }, [projectPath]);

  if (!stat || stat.files_changed === 0) return null;

  return (
    <span style={{ ...pillBase, ...pill.style, cursor: "default" }} {...pill.handlers}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}>
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span style={{ color: "rgb(var(--aegis-text-dim))" }}>{stat.files_changed}</span>
      {stat.insertions > 0 && <span style={{ color: "rgb(34 197 94)" }}>+{stat.insertions}</span>}
      {stat.deletions  > 0 && <span style={{ color: "rgb(239 68 68)" }}>&minus;{stat.deletions}</span>}
    </span>
  );
}

// ── Env pills ─────────────────────────────────────────────────────────────
function NodeVersionSlot({ version }: { version: string }) {
  const pill = usePillHover();
  return (
    <span style={{ ...pillBase, ...pill.style, cursor: "default" }} {...pill.handlers}>
      <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7, letterSpacing: "-0.5px" }}>N</span>
      {version}
    </span>
  );
}

function PythonVenvSlot({ venv }: { venv: string }) {
  const pill = usePillHover();
  return (
    <span style={{ ...pillBase, ...pill.style, cursor: "default" }} {...pill.handlers}>
      <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>py</span>
      {venv}
    </span>
  );
}

function GoVersionSlot({ version }: { version: string }) {
  const pill = usePillHover();
  return (
    <span style={{ ...pillBase, ...pill.style, cursor: "default" }} {...pill.handlers}>
      <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>go</span>
      {version}
    </span>
  );
}

function ProxySlot({ proxy }: { proxy: ShellProxyInfo }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pill = usePillHover();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const copyEntry = async (entry: string) => {
    try { await navigator.clipboard.writeText(entry); } catch {}
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button title="Show proxy environment" onClick={() => setOpen((value) => !value)} style={{ ...pillBase, ...pill.style }} {...pill.handlers}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.65, flexShrink: 0 }}>
          <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.93 4.93l2.12 2.12m9.9 9.9 2.12 2.12M2 12h3m14 0h3M4.93 19.07l2.12-2.12m9.9-9.9 2.12-2.12"/>
        </svg>
        {proxy.summary}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, bottom: 30, zIndex: 200, width: 330, maxHeight: 220, overflowY: 'auto', padding: 4, borderRadius: 6, background: 'rgb(var(--aegis-elevated))', border: '1px solid rgb(var(--aegis-overlay)/0.14)', boxShadow: '0 8px 24px rgb(0 0 0 / 0.4)' }}>
          {proxy.entries.map((entry) => (
            <button key={entry} type="button" onClick={() => void copyEntry(entry)} style={{ display: 'block', width: '100%', border: 'none', borderRadius: 4, background: 'transparent', padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', color: 'rgb(var(--aegis-text))', cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }} onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}>
              {entry}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentActivitySlot({ activity }: { activity: TerminalAgentActivity }) {
  const pill = usePillHover();
  const label = activity.agent === 'claude' ? 'Claude Code'
    : activity.agent === 'codex' ? 'Codex' : 'OpenCode';
  const needsAttention = activity.state === 'attention';
  return (
    <span title={`${label} ${needsAttention ? 'needs attention' : 'running'}`} style={{ ...pillBase, ...pill.style, color: 'rgb(var(--aegis-text))', cursor: 'default' }} {...pill.handlers}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: needsAttention ? 'rgb(245 158 11)' : 'rgb(34 197 94)', boxShadow: `0 0 0 2px ${needsAttention ? 'rgb(245 158 11 / 0.12)' : 'rgb(34 197 94 / 0.12)'}`, flexShrink: 0 }} />
      <Bot size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
      {label}
    </span>
  );
}

function ToolCallSlot({ calls }: { calls: TerminalToolCall[] }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const pill = usePillHover();
  const latest = calls.at(-1);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (!calls.some((call) => call.state === 'running')) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [calls]);
  if (!latest) return null;
  const active = latest.state === 'running';
  const presentation = (state: TerminalToolCall['state']) => state === 'running'
    ? { color: 'rgb(59 130 246)', glyph: '...' }
    : state === 'failed' ? { color: 'rgb(239 68 68)', glyph: 'x' }
      : state === 'stalled' ? { color: 'rgb(var(--aegis-text-dim))', glyph: 'o' }
        : { color: 'rgb(34 197 94)', glyph: 'check' };
  const latestPresentation = presentation(latest.state);
  const counts = calls.reduce((acc, call) => {
    const key = call.toolName.toLowerCase();
    if (key === 'bash') acc.bash += 1;
    else if (key === 'edit' || key === 'write' || key === 'multiedit') acc.edit += 1;
    else if (key === 'read') acc.read += 1;
    else acc.other += 1;
    return acc;
  }, { bash: 0, edit: 0, read: 0, other: 0 });
  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 0 }}>
      <button type="button" title={`${latest.toolName}${latest.identifier ? `: ${latest.identifier}` : ''}`} onClick={() => setOpen((value) => !value)} style={{ ...pillBase, ...pill.style, color: 'rgb(var(--aegis-text))', maxWidth: 260 }} {...pill.handlers}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: latestPresentation.color, flexShrink: 0 }} />
        <Wrench size={11} strokeWidth={1.8} style={{ color: latestPresentation.color, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{latest.toolName}{latest.identifier ? ` ${latest.identifier}` : ''}</span>
        <span style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }}>· {formatTerminalToolDuration(latest, now)} · {latestPresentation.glyph}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: 30, left: 0, zIndex: 200, width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: 360, overflowY: 'auto', borderRadius: 6, background: 'rgb(var(--aegis-elevated))', border: '1px solid rgb(var(--aegis-overlay)/0.14)', boxShadow: '0 8px 24px rgb(0 0 0 / 0.4)' }}>
          <div style={{ display: 'flex', gap: 12, padding: '10px 14px', borderBottom: '1px solid rgb(var(--aegis-overlay)/0.12)', color: 'rgb(var(--aegis-text-dim))', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
            <span>{counts.bash} Bash</span><span>{counts.edit} Edit</span><span>{counts.read} Read</span>{counts.other > 0 && <span>{counts.other} Other</span>}
          </div>
          {[...calls].reverse().map((call) => {
            const item = presentation(call.state);
            return (
            <div key={call.id} title={call.identifier} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', color: 'rgb(var(--aegis-text))', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
              <Wrench size={11} strokeWidth={1.8} style={{ flexShrink: 0 }} />
              <span style={{ width: 64, flexShrink: 0, color: item.color }}>{call.toolName}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{call.identifier || '-'}</span>
              <span style={{ width: 52, textAlign: 'right', color: 'rgb(var(--aegis-text-dim))' }}>{formatTerminalToolDuration(call, now)}</span>
              <span style={{ width: 24, textAlign: 'center', color: item.color }}>{item.glyph}</span>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

function RemoteHostSlot({ host }: { host: string }) {
  const pill = usePillHover();
  return (
    <span title={`SSH ${host}`} style={{ ...pillBase, ...pill.style, maxWidth: 220, cursor: 'default' }} {...pill.handlers}>
      <Server size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</span>
    </span>
  );
}

interface TerminalEnvInfo { node_version: string | null; python_venv: string | null; go_version: string | null; }

function EnvPills({ projectPath }: { projectPath: string }) {
  const [env, setEnv] = useState<TerminalEnvInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      invoke<TerminalEnvInfo>("get_terminal_env", { projectPath })
        .then((result) => { if (!cancelled) setEnv(result); })
        .catch(() => { if (!cancelled) setEnv(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [projectPath]);

  if (!env) return null;
  return (
    <>
      {env.node_version && <NodeVersionSlot version={env.node_version} />}
      {env.python_venv  && <PythonVenvSlot  venv={env.python_venv}     />}
      {env.go_version   && <GoVersionSlot   version={env.go_version}   />}
    </>
  );
}

// ── PaneStatusBar ──────────────────────────────────────────────────────────
export interface PaneStatusBarProps {
  projectPath: string;
  paneId: string;
  onToggleComposer?: () => void;
  composerActive?: boolean;
  canZoom?: boolean;
  isZoomed?: boolean;
  onZoom?: () => void;
  proxy?: ShellProxyInfo | null;
  agentActivity?: TerminalAgentActivity;
  toolCalls?: TerminalToolCall[];
  /** SSH workspace address. Remote sessions must never query local Git/env. */
  remoteHost?: string;
}

export function PaneStatusBar({
  projectPath, paneId, onToggleComposer, composerActive, canZoom, isZoomed, onZoom, proxy, agentActivity, toolCalls, remoteHost,
}: PaneStatusBarProps) {

  useEffect(() => {
    const h = (e: Event) => {
      const ce = e as CustomEvent<{ paneId: string }>;
      if (ce.detail?.paneId === paneId) onToggleComposer?.();
    };
    window.addEventListener("junqi:toggle-composer", h);
    return () => window.removeEventListener("junqi:toggle-composer", h);
  }, [paneId, onToggleComposer]);

  const isMac     = APP_PLATFORM === "macos";
  const composeTip = isMac ? "Compose (\u2318L)" : "Compose (Ctrl+L)";
  const zoomTip    = isZoomed
    ? (isMac ? "Exit Zoom (\u2318\u21e7E)" : "Exit Zoom (Ctrl+Shift+E)")
    : (isMac ? "Zoom Pane (\u2318\u21e7E)" : "Zoom Pane (Ctrl+Shift+E)");

  return (
    <div style={{
      minHeight: 32, flexShrink: 0,
      display: "flex", alignItems: "center",
      padding: "5px 8px", gap: 4,
      borderTop: "1px solid rgb(255 255 255 / 0.06)",
      background: "rgb(var(--aegis-surface))",
      overflow: "visible",
    }}>
      {/* LEFT — zoom (conditional) + compose (always present) */}
      {canZoom && onZoom && (
        <StatusBarIconButton isActive={!!isZoomed} help={zoomTip} onClick={onZoom}>
          {isZoomed
            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          }
        </StatusBarIconButton>
      )}
      <StatusBarIconButton isActive={!!composerActive} help={composeTip} onClick={() => onToggleComposer?.()}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          <path d="m15 5 4 4"/>
        </svg>
      </StatusBarIconButton>

      {/* Spacer — FlowLayout maxWidth:infinity equivalent */}
      {/* RIGHT — env pills + git pills (trailing, wraps on narrow panes) */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {remoteHost ? <RemoteHostSlot host={remoteHost} /> : <EnvPills projectPath={projectPath} />}
        {agentActivity && <AgentActivitySlot activity={agentActivity} />}
        {toolCalls && toolCalls.length > 0 && <ToolCallSlot calls={toolCalls} />}
        {!remoteHost && proxy && <ProxySlot proxy={proxy} />}
        {!remoteHost && <GitBranchSlot projectPath={projectPath} />}
        {!remoteHost && <GitDiffSlot projectPath={projectPath} />}
      </div>
    </div>
  );
}
