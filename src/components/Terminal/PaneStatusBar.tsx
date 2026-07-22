// kooky PaneStatusBar 1:1 port — bottom status bar (32px)
// Layout mirrors kooky exactly:
//   LEFT:  [ZoomButton] [ComposerToggle]
//   RIGHT: FlowLayout { EnvPills · GitBranchSlot · GitDiffSlot }
//
// Data sources: git_diff_shortstat / get_terminal_env / git_list_branches (Tauri IPC).

import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useSyncExternalStore } from "react";
import { APP_PLATFORM } from "./platform";
import { invoke } from "@tauri-apps/api/core";
import { debugError } from "@/utils/debugLog";
import { readTerminalGitFileDiff } from '@/services/workspaceFs';
import {
  BookOpen,
  Check,
  Circle,
  CircleHelp,
  Clock3,
  FileText,
  GitBranch,
  Globe2,
  Hexagon,
  Hourglass,
  List,
  Network,
  PanelsTopLeft,
  Pencil,
  Diff,
  Search,
  Terminal as TerminalIcon,
  User,
} from 'lucide-react';
import {
  formatTerminalElapsedDuration,
  formatTerminalToolDuration,
  type ShellProxyInfo,
  type TerminalAgentActivity,
  type TerminalToolCall,
} from './shellLifecycle';
import {
  getTerminalStatusPreferencesSnapshot,
  subscribeTerminalStatusPreferences,
  visibleTerminalStatusItems,
  type TerminalStatusItem,
} from './terminalStatusPreferences';
import { requestTerminalFileTreeReveal, requestTerminalInput } from './terminalChromeEvents';
import { TerminalKookyMenuDivider, TerminalKookyMenuItem } from './KookyMenu';
import { buildTerminalProxyUnsetInput } from './terminalStatusActions';
import {
  selectTerminalToolCallPillVariant,
  type TerminalToolCallPillVariant,
} from './terminalToolCallPillLayout';

// ── Shared pill style (kooky StatusSegment / bracket-bordered pill) ───────
const pillBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "3px 8px",
  minHeight: 22,
  boxSizing: 'border-box',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace',
  color: "rgb(var(--aegis-text))",
  background: "transparent",
  border: "1px solid rgb(var(--aegis-text-dim))",
  cursor: "pointer",
  transition: "background 0.12s",
  whiteSpace: "nowrap" as const,
  lineHeight: "1" as const,
};

function usePillHover(open = false) {
  const [hovered, setHovered] = useState(false);
  const activeStyle = { background: "rgb(var(--aegis-overlay)/0.07)", borderColor: "rgb(var(--aegis-text-dim))" };
  const idleStyle   = { background: "transparent", borderColor: "rgb(var(--aegis-text-dim))" };
  return {
    hovered: hovered || open,
    handlers: { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
    style: hovered || open ? activeStyle : idleStyle,
  };
}

// ── StatusBarIconButton (kooky StatusBarIconButton) ───────────────────────
function StatusBarIconButton({
  children, isActive, help, onClick,
}: { children: React.ReactNode; isActive?: boolean; help: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const bg     = isActive ? "rgb(var(--aegis-overlay)/0.15)" : hovered ? "rgb(var(--aegis-overlay)/0.07)" : "transparent";
  const border = "1px solid rgb(var(--aegis-overlay)/0.07)";
  const color  = isActive ? "rgb(var(--aegis-text))" : "rgb(var(--aegis-text-dim))";
  return (
    <button onClick={onClick} title={help}
      style={{ ...pillBase, background: bg, border, color, width: 22, height: 22, minHeight: 22, padding: 0, justifyContent: "center" }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

// ── GitBranchSlot ─────────────────────────────────────────────────────────
function GitBranchSlot({ projectPath }: { projectPath: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const pill = usePillHover(popoverOpen || loading);

  useEffect(() => {
    loadRequestRef.current += 1;
    setPopoverOpen(false);
    setLoading(false);
    setBranches([]);
    setBranch(null);
  }, [projectPath]);

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
    if (popoverOpen || loading) {
      loadRequestRef.current += 1;
      setLoading(false);
      setPopoverOpen(false);
      return;
    }
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    invoke<{ name: string; current: boolean }[]>("git_list_branches", { projectPath })
      .then((list) => {
        if (requestId !== loadRequestRef.current) return;
        setBranches(list);
        setBranch(list.find((item) => item.current)?.name ?? null);
        setPopoverOpen(true);
      })
      .catch(() => {
        if (requestId === loadRequestRef.current) setBranches([]);
      })
      .finally(() => {
        if (requestId === loadRequestRef.current) setLoading(false);
      });
  }, [loading, popoverOpen, projectPath]);

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
      <button type="button" title="Switch Git branch" onClick={handleToggle} style={{ ...pillBase, ...pill.style }} {...pill.handlers}>
        <GitBranch size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
        {branch}
      </button>
      {popoverOpen && (
        <div className="terminal-kooky-menu" role="menu" style={{
          position: "absolute", bottom: 30, left: 0, zIndex: 200,
          width: 230, maxWidth: 'calc(100vw - 32px)', maxHeight: 320, overflowY: "auto",
          border: "1px solid rgb(var(--aegis-overlay) / 0.10)", borderRadius: 6,
          boxShadow: "0 10px 30px rgb(0 0 0 / 0.42)", padding: 4,
        }}>
          {branches.map((item) => (
            <TerminalKookyMenuItem
              key={item.name}
              label={item.name}
              disabled={item.name === branch}
              leading={<Check size={12} strokeWidth={2} style={{ opacity: item.name === branch ? 1 : 0 }} />}
              onClick={() => handleCheckout(item.name)}
            />
          ))}
          {branches.length === 0 && (
            <TerminalKookyMenuItem label="No local branches found" disabled onClick={() => {}} />
          )}
        </div>
      )}
    </div>
  );
}

// ── GitDiffSlot ───────────────────────────────────────────────────────────
// kooky diffSegment: filesChanged(muted) · +insertions(green) · -deletions(red)
interface GitDiffSummary { files_changed: number; insertions: number; deletions: number; }
type GitDiffPresentation = Awaited<ReturnType<typeof readTerminalGitFileDiff>> & { loadError?: boolean };

function summarizeGitDiff(files: GitDiffPresentation['files']): GitDiffSummary {
  return files.reduce<GitDiffSummary>((summary, file) => ({
    files_changed: summary.files_changed + 1,
    insertions: summary.insertions + file.insertions,
    deletions: summary.deletions + file.deletions,
  }), { files_changed: 0, insertions: 0, deletions: 0 });
}

function SignedDiffCount({ sign, value, color }: { sign: '+' | '−'; value: number; color: string }) {
  return (
    <span style={{ color, whiteSpace: 'nowrap' }}>
      <span style={{ opacity: 0.6 }}>{sign}</span>{value}
    </span>
  );
}

function DiffCountBadge({ insertions, deletions }: { insertions: number; deletions: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace', fontSize: 11 }}>
      {insertions > 0 && <SignedDiffCount sign="+" value={insertions} color="rgb(115 199 128)" />}
      {deletions > 0 && <SignedDiffCount sign="−" value={deletions} color="rgb(232 102 102)" />}
      {insertions === 0 && deletions === 0 && <span style={{ color: 'rgb(var(--aegis-text-dim))' }}>±</span>}
    </span>
  );
}

function GitDiffSlot({ projectPath }: { projectPath: string }) {
  const [stat, setStat] = useState<GitDiffSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [presentation, setPresentation] = useState<GitDiffPresentation | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const pill = usePillHover(open || loading);

  useEffect(() => {
    loadRequestRef.current += 1;
    setOpen(false);
    setLoading(false);
    setPresentation(null);
    setStat(null);
  }, [projectPath]);

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

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const togglePresentation = useCallback(() => {
    if (open || loading) {
      loadRequestRef.current += 1;
      setLoading(false);
      setOpen(false);
      return;
    }
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    readTerminalGitFileDiff(projectPath)
      .then((snapshot) => {
        if (requestId !== loadRequestRef.current) return;
        setPresentation(snapshot);
        setStat(summarizeGitDiff(snapshot.files));
        setOpen(true);
      })
      .catch(() => {
        if (requestId !== loadRequestRef.current) return;
        setPresentation({ root: projectPath, repository_root: null, files: [], loadError: true });
        setOpen(true);
      })
      .finally(() => {
        if (requestId === loadRequestRef.current) setLoading(false);
      });
  }, [loading, open, projectPath]);

  const revealFileTree = useCallback(() => {
    requestTerminalFileTreeReveal(presentation?.repository_root ?? projectPath);
    setOpen(false);
  }, [presentation?.repository_root, projectPath]);

  if (!stat || stat.files_changed === 0) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" title="Show changed files" onClick={togglePresentation} style={{ ...pillBase, ...pill.style }} {...pill.handlers}>
        <Diff size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
        <span style={{ color: 'rgb(var(--aegis-text-dim))' }}>{stat.files_changed}</span>
        {stat.insertions > 0 && <SignedDiffCount sign="+" value={stat.insertions} color="rgb(115 199 128)" />}
        {stat.deletions > 0 && <SignedDiffCount sign="−" value={stat.deletions} color="rgb(232 102 102)" />}
      </button>
      {open && presentation && (
        <div className="terminal-kooky-menu" role="menu" style={{
          position: 'absolute', right: 0, bottom: 30, zIndex: 200,
          width: 320, maxWidth: 'calc(100vw - 32px)', maxHeight: 360,
          display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 4,
          border: '1px solid rgb(var(--aegis-overlay) / 0.10)', borderRadius: 6,
          boxShadow: '0 10px 30px rgb(0 0 0 / 0.42)',
        }}>
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {presentation.loadError ? (
              <TerminalKookyMenuItem label="Unable to load changes" disabled onClick={() => {}} />
            ) : presentation.files.length === 0 ? (
              <TerminalKookyMenuItem label="No changes found" disabled onClick={() => {}} />
            ) : presentation.files.map((file) => (
              <div key={file.path} title={file.relative_path} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '5px 10px', fontFamily: '"Kooky Onest", "Onest", sans-serif', fontSize: 12.5, color: 'rgb(var(--aegis-text))' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.relative_path}</span>
                <DiffCountBadge insertions={file.insertions} deletions={file.deletions} />
              </div>
            ))}
          </div>
          <TerminalKookyMenuDivider />
          <TerminalKookyMenuItem label="Show in File Tree" onClick={revealFileTree} />
        </div>
      )}
    </div>
  );
}

// ── Env pills ─────────────────────────────────────────────────────────────
function NodeVersionSlot({ version }: { version: string }) {
  const pill = usePillHover();
  return (
    <span style={{ ...pillBase, ...pill.style, cursor: "default" }} {...pill.handlers}>
      <Hexagon size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
      {version}
    </span>
  );
}

function PythonVenvSlot({ venv }: { venv: string }) {
  const pill = usePillHover();
  return (
    <span style={{ ...pillBase, ...pill.style, cursor: "default" }} {...pill.handlers}>
      <span aria-hidden="true" style={{ position: 'relative', width: 11, height: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }}>
        <Circle size={11} strokeWidth={1.8} />
        <span style={{ position: 'absolute', fontSize: 7, fontWeight: 700, lineHeight: 1 }}>p</span>
      </span>
      {venv}
    </span>
  );
}

function ProxySlot({ proxy }: { proxy: ShellProxyInfo }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pill = usePillHover(open);

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

  const unsetEntry = (entry: string) => {
    const input = buildTerminalProxyUnsetInput(
      entry,
      APP_PLATFORM === 'windows' ? 'powershell' : 'posix',
    );
    if (!input) return;
    requestTerminalInput(input);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" title="Show proxy env (click text to copy)" onClick={() => setOpen((value) => !value)} style={{ ...pillBase, ...pill.style }} {...pill.handlers}>
        <Network size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
        {proxy.summary}
      </button>
      {open && (
        <div className="terminal-kooky-menu" role="menu" style={{ position: 'absolute', right: 0, bottom: 30, zIndex: 200, width: 380, maxWidth: 'calc(100vw - 32px)', maxHeight: 240, overflowY: 'auto', padding: 4, borderRadius: 6, border: '1px solid rgb(var(--aegis-overlay) / 0.10)', boxShadow: '0 10px 30px rgb(0 0 0 / 0.42)' }}>
          {proxy.entries.map((entry) => (
            <div key={entry} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 10px', borderRadius: 5 }} onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay) / 0.07)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}>
              <button type="button" title="Copy" onClick={() => void copyEntry(entry)} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 'none', padding: 0, background: 'transparent', color: 'rgb(var(--aegis-text))', cursor: 'pointer', textAlign: 'left', fontFamily: '"Kooky Onest", "Onest", sans-serif', fontSize: 12.5 }}>
                {entry}
              </button>
              <button type="button" title={`unset ${entry.slice(0, entry.indexOf('='))}`} onClick={() => unsetEntry(entry)} style={{ flexShrink: 0, border: 'none', borderRadius: 4, padding: '3px 7px', background: 'rgb(var(--aegis-text-dim) / 0.6)', color: 'rgb(var(--aegis-text))', cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
                Unset
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ToolCallPresentation = {
  textColor: string;
  glyphColor: string;
  glyph: string;
  accessibleName: string;
};

function toolCallPresentation(state: TerminalToolCall['state']): ToolCallPresentation {
  switch (state) {
    case 'running':
      return { textColor: 'rgb(var(--aegis-status-running))', glyphColor: 'rgb(var(--aegis-status-running))', glyph: '⋯', accessibleName: 'running' };
    case 'success':
      return { textColor: 'rgb(var(--aegis-text))', glyphColor: 'rgb(115 199 128)', glyph: '✓', accessibleName: 'succeeded' };
    case 'failed':
      return { textColor: 'rgb(var(--aegis-status-failed))', glyphColor: 'rgb(var(--aegis-status-failed))', glyph: '✗', accessibleName: 'failed' };
    case 'stalled':
      return { textColor: 'rgb(var(--aegis-text-muted))', glyphColor: 'rgb(var(--aegis-text-muted))', glyph: '⊘', accessibleName: 'stalled' };
  }
}

function ToolCallIcon({ toolName, size = 11 }: { toolName: string; size?: number }) {
  const key = toolName.toLowerCase();
  const props = { size, strokeWidth: 1.8, 'aria-hidden': true };
  if (key === 'bash') return <TerminalIcon {...props} />;
  if (key === 'edit' || key === 'write' || key === 'multiedit') return <Pencil {...props} />;
  if (key === 'read') return <FileText {...props} />;
  if (key === 'notebookedit') return <BookOpen {...props} />;
  if (key === 'glob' || key === 'grep' || key === 'find') return <Search {...props} />;
  if (key === 'ls') return <List {...props} />;
  if (key === 'webfetch' || key === 'websearch') return <Globe2 {...props} />;
  if (key === 'task') return <PanelsTopLeft {...props} />;
  return <CircleHelp {...props} />;
}

function ToolCallCounter({ toolName, count, label }: { toolName: string; count: number; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} aria-label={`${label} count: ${count}`}>
      <span style={{ color: 'rgb(var(--aegis-text-muted))', display: 'inline-flex' }}><ToolCallIcon toolName={toolName} size={11} /></span>
      <span style={{ color: 'rgb(var(--aegis-text))', fontWeight: 500 }}>{count}</span>
      <span style={{ color: 'rgb(var(--aegis-text-muted))', fontSize: 10 }}>{label}</span>
    </span>
  );
}

function toolCallSessionDuration(calls: readonly TerminalToolCall[], now: number): string {
  const first = calls[0];
  if (!first) return '—';
  const end = calls.some((call) => call.state === 'running')
    ? now
    : Math.max(...calls.map((call) => call.completedAt ?? call.startedAt));
  return formatTerminalElapsedDuration(end - first.startedAt);
}

function ToolCallPillContent({
  latest,
  presentation,
  now,
  variant,
}: {
  latest: TerminalToolCall;
  presentation: ToolCallPresentation;
  now: number;
  variant: TerminalToolCallPillVariant;
}) {
  return (
    <>
      <span className="terminal-kooky-tool-call-icon"><ToolCallIcon toolName={latest.toolName} /></span>
      {variant === 'full' && <><span className="terminal-kooky-tool-call-name" style={{ color: presentation.textColor }}>{latest.toolName}</span><span className="terminal-kooky-tool-call-separator">·</span></>}
      {variant !== 'icon' && <><span className={`terminal-kooky-tool-call-identifier${variant === 'identifier' ? ' terminal-kooky-tool-call-identifier--compact' : ''}`} style={{ color: presentation.textColor }}>{latest.identifier || '—'}</span><span className="terminal-kooky-tool-call-separator terminal-kooky-tool-call-duration-separator">·</span><span className="terminal-kooky-tool-call-duration" style={{ color: presentation.textColor }}>{formatTerminalToolDuration(latest, now)}</span></>}
      <span className="terminal-kooky-tool-call-glyph" style={{ color: presentation.glyphColor }}>{presentation.glyph}</span>
    </>
  );
}

/** Exact Kooky state hierarchy, driven only by emitted terminal hooks. */
function ToolCallSlot({ calls }: { calls: TerminalToolCall[] }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [measurements, setMeasurements] = useState<{
    availableWidth: number | null;
    fullWidth: number | null;
    identifierWidth: number | null;
  }>({ availableWidth: null, fullWidth: null, identifierWidth: null });
  const wrapRef = useRef<HTMLDivElement>(null);
  const fullMeasureRef = useRef<HTMLSpanElement>(null);
  const identifierMeasureRef = useRef<HTMLSpanElement>(null);
  const latest = calls.at(-1);
  const pillVariant = selectTerminalToolCallPillVariant(measurements);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const report = () => {
      const next = {
        availableWidth: Math.round(node.getBoundingClientRect().width),
        fullWidth: fullMeasureRef.current ? Math.ceil(fullMeasureRef.current.getBoundingClientRect().width) : null,
        identifierWidth: identifierMeasureRef.current ? Math.ceil(identifierMeasureRef.current.getBoundingClientRect().width) : null,
      };
      setMeasurements((current) => (
        current.availableWidth === next.availableWidth
        && current.fullWidth === next.fullWidth
        && current.identifierWidth === next.identifierWidth
          ? current
          : next
      ));
    };
    const observer = new ResizeObserver(report);
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    report();
    return () => observer.disconnect();
  }, [latest?.id, latest?.identifier, latest?.state, latest?.toolName]);

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
  const counts = calls.reduce((acc, call) => {
    const key = call.toolName.toLowerCase();
    if (key === 'bash') acc.bash += 1;
    else if (key === 'edit' || key === 'write' || key === 'multiedit') acc.edit += 1;
    else if (key === 'read') acc.read += 1;
    else acc.other += 1;
    return acc;
  }, { bash: 0, edit: 0, read: 0, other: 0 });
  const latestPresentation = latest ? toolCallPresentation(latest.state) : null;
  const latestLabel = latest
    ? `${latest.toolName}, ${latest.identifier || 'no identifier'}, ${formatTerminalToolDuration(latest, now)}, ${latestPresentation?.accessibleName}`
    : 'Waiting for Claude tool calls';
  return (
    <div ref={wrapRef} style={{ position: 'relative', display: latest ? 'grid' : 'block', minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
      {latest && latestPresentation && (
        <>
          <span
            ref={fullMeasureRef}
            aria-hidden="true"
            className="terminal-kooky-tool-call-pill"
            style={{ gridArea: '1 / 1', visibility: 'hidden', width: 'max-content', maxWidth: 'none', pointerEvents: 'none' }}
          >
            <ToolCallPillContent latest={latest} presentation={latestPresentation} now={now} variant="full" />
          </span>
          <span
            ref={identifierMeasureRef}
            aria-hidden="true"
            className="terminal-kooky-tool-call-pill"
            style={{ position: 'absolute', visibility: 'hidden', width: 'max-content', maxWidth: 'none', pointerEvents: 'none' }}
          >
            <ToolCallPillContent latest={latest} presentation={latestPresentation} now={now} variant="identifier" />
          </span>
        </>
      )}
      <button
        type="button"
        title={latest ? `${latest.toolName}${latest.identifier ? `: ${latest.identifier}` : ''}` : 'Waiting for tool calls'}
        aria-label={latestLabel}
        onClick={() => setOpen((value) => !value)}
        className="terminal-kooky-tool-call-pill"
        style={{ gridArea: latest ? '1 / 1' : undefined, minWidth: 0, maxWidth: '100%', width: latest ? '100%' : undefined }}
      >
        {latest ? (
          latestPresentation && <ToolCallPillContent latest={latest} presentation={latestPresentation} now={now} variant={pillVariant} />
        ) : (
          <>
            <span className="terminal-kooky-tool-call-icon"><Hourglass size={11} strokeWidth={1.8} aria-hidden="true" /></span>
            <span className="terminal-kooky-tool-call-waiting">waiting</span>
          </>
        )}
      </button>
      {open && (
        <div className="terminal-kooky-tool-call-history" style={{ position: 'absolute', bottom: 30, left: 0, zIndex: 200, width: 520, maxWidth: 'calc(100vw - 32px)', height: 360 }}>
          <div className="terminal-kooky-tool-call-history-header">
            <ToolCallCounter toolName="bash" count={counts.bash} label="Bash" />
            <ToolCallCounter toolName="edit" count={counts.edit} label="Edit" />
            <ToolCallCounter toolName="read" count={counts.read} label="Read" />
            {counts.other > 0 && <ToolCallCounter toolName="other" count={counts.other} label="Other" />}
            <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'rgb(var(--aegis-text))', fontWeight: 500 }}><Clock3 size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-muted))' }} />{toolCallSessionDuration(calls, now)}</span>
          </div>
          <div className="terminal-kooky-tool-call-history-list">
            {[...calls].reverse().map((call) => {
              const item = toolCallPresentation(call.state);
              return (
                <div key={call.id} title={call.identifier} className="terminal-kooky-tool-call-history-row">
                  <span style={{ width: 14, display: 'inline-flex', color: 'rgb(var(--aegis-text-muted))' }}><ToolCallIcon toolName={call.toolName} /></span>
                  <span style={{ width: 64, flexShrink: 0, color: item.textColor }}>{call.toolName}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: item.textColor }}>{call.identifier || '—'}</span>
                  <span style={{ width: 56, textAlign: 'right', color: item.textColor }}>{formatTerminalToolDuration(call, now)}</span>
                  <span style={{ width: 14, textAlign: 'center', color: item.glyphColor, fontWeight: 500 }}>{item.glyph}</span>
                </div>
              );
            })}
            {calls.length === 0 && (
              <div className="terminal-kooky-tool-call-history-empty"><Hourglass size={16} strokeWidth={1.6} /><span>waiting for tool calls</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteHostSlot({ host }: { host: string }) {
  const pill = usePillHover();
  return (
    <span title={`SSH ${host}`} style={{ ...pillBase, ...pill.style, maxWidth: 220, cursor: 'default' }} {...pill.handlers}>
      <User size={11} strokeWidth={1.8} style={{ color: 'rgb(var(--aegis-text-dim))', flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</span>
    </span>
  );
}

interface TerminalEnvInfo { node_version: string | null; python_venv: string | null; }

function useTerminalEnvironment(projectPath: string, enabled: boolean): TerminalEnvInfo | null {
  const [env, setEnv] = useState<TerminalEnvInfo | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEnv(null);
      return undefined;
    }
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
  }, [enabled, projectPath]);

  return env;
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
  const statusPreferences = useSyncExternalStore(
    subscribeTerminalStatusPreferences,
    getTerminalStatusPreferencesSnapshot,
    getTerminalStatusPreferencesSnapshot,
  );
  const visibleItems = visibleTerminalStatusItems(statusPreferences);
  const environment = useTerminalEnvironment(projectPath, !remoteHost);
  const hasItem = (item: TerminalStatusItem) => visibleItems.includes(item);
  const statusSegment = (item: TerminalStatusItem): React.ReactNode => {
    if (item === 'remote-login') return remoteHost ? <RemoteHostSlot key={item} host={remoteHost} /> : null;
    if (remoteHost) return null;
    switch (item) {
      case 'python-venv': return environment?.python_venv ? <PythonVenvSlot key={item} venv={environment.python_venv} /> : null;
      case 'node-version': return environment?.node_version ? <NodeVersionSlot key={item} version={environment.node_version} /> : null;
      case 'proxy': return proxy ? <ProxySlot key={item} proxy={proxy} /> : null;
      case 'git-branch': return <GitBranchSlot key={item} projectPath={projectPath} />;
      case 'git-diff': return <GitDiffSlot key={item} projectPath={projectPath} />;
      case 'tool-calls': return null;
    }
  };

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
      padding: "5px 8px", gap: 8,
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

      {hasItem('tool-calls') && (toolCalls?.length || agentActivity?.agent === 'claude') ? <ToolCallSlot calls={toolCalls ?? []} /> : null}

      {/* Spacer — FlowLayout maxWidth:infinity equivalent */}
      {/* RIGHT — env pills + git pills (trailing, wraps on narrow panes) */}
      <div style={{ display: "flex", alignItems: "center", columnGap: 8, rowGap: 4, flex: 1, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {visibleItems.filter((item) => item !== 'tool-calls').map(statusSegment)}
      </div>
    </div>
  );
}
