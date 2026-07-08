// ═══════════════════════════════════════════════════════════
// AgentRunView — 1:1 port of nezha's NewTaskView + RunningView
//
// Layout matches nezha's original:
//   Header: dynamic GIF (agent-branded) + missing-file warning
//   Body:   PromptEditor (@-mentions + image/text attachments)
//   Footer: AgentPermSelector + LaunchModeSelector + Send/Save
//   Running: terminal (xterm.js) + session metrics + worktree actions
//
// Source: nezha/src/components/NewTaskView.tsx (612 lines)
//         nezha/src/components/RunningView.tsx (788 lines)
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import {
  Play, Square, RotateCcw, ChevronDown, ChevronRight, AlertCircle,
  ExternalLink, GitBranch, GitMerge, Trash2, Clock,
  Loader2, BarChart3, FileText, CheckCircle2, XCircle,
  Activity, FileWarning, Image as ImageIcon, Bookmark, Command,
  CornerDownLeft, Laptop, GitPullRequestArrow, Plus, RefreshCw,
  Search, X, Check, Globe, List, Box, SquareTerminal, Pencil, Folder,
} from 'lucide-react';
import {
  Sparkle,
  Robot,
  Pi,
  Diamond,
  CursorClick,
  Lightning,
  Hexagon,
  XLogo,
  Cloud,
  ArrowCircleUp,
  Moon as MoonPh,
  BracketsCurly,
  Wrench as WrenchPh,
  Brain as BrainPh,
} from '@phosphor-icons/react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PromptEditor, type ImageAttach } from '@/components/shared/PromptEditor';
import { StatusIcon, type StatusIconValue } from '@/components/shared/StatusIcon';
import { StatusBadge, type LifecycleState } from '@/components/shared/StatusBadge';
import { ToolCallActivityPill, type ToolCallEvent, type ToolStats } from '@/components/shared/ToolCallHistoryPopover';
import { useSessionHistoryStore } from '@/stores/sessionHistoryStore';
import { debugError, debugWarn } from '@/utils/debugLog';

async function loadTerminalDeps() {
  const [{ Terminal }, { FitAddon }, { Unicode11Addon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-unicode11'),
    import('@xterm/xterm/css/xterm.css'),
  ]);
  return { Terminal, FitAddon, Unicode11Addon };
}

// ── Types (matching nezha's types.ts) ──────────────────────────────────────

type AgentType = 'claude' | 'codex' | 'pi';
type PermissionMode = 'ask' | 'auto_edit' | 'full_access';
type LaunchMode = 'local' | 'worktree';

interface SessionMetrics {
  tool_calls: number;
  duration_secs: number;
  session_file_bytes: number;
  total_tokens: number;
  context_tokens: number;
  context_window: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

// Agent banner icons (phosphor regular — polished, SF-Symbol-grade, 24px)
const AGENT_BRANDS: Record<string, { bg: string; icon: React.ReactNode; label: string }> = {
  claude:     { bg: 'linear-gradient(135deg, #d97757, #a84e32)', icon: <Sparkle size={24} weight="regular" className="text-amber-200" />, label: 'Claude Code' },
  codex:      { bg: 'linear-gradient(135deg, #7a9dff, #3a5dc0)', icon: <Robot size={24} weight="regular" className="text-blue-200" />, label: 'Codex' },
  pi:         { bg: 'linear-gradient(135deg, #c2c5ce, #80838c)', icon: <Pi size={24} weight="regular" className="text-gray-200" />, label: 'Pi' },
  gemini:     { bg: 'linear-gradient(135deg, #3186ff, #1a47b8)', icon: <Diamond size={24} weight="regular" className="text-blue-200" />, label: 'Gemini CLI' },
  'cursor-agent': { bg: 'linear-gradient(135deg, #f54e00, #b83800)', icon: <CursorClick size={24} weight="regular" className="text-orange-200" />, label: 'Cursor CLI' },
  amp:        { bg: 'linear-gradient(135deg, #e8b168, #c4852e)', icon: <Lightning size={24} weight="regular" className="text-amber-200" />, label: 'Amp' },
  copilot:    { bg: 'linear-gradient(135deg, #6e40c9, #4520a0)', icon: <Hexagon size={24} weight="regular" className="text-purple-200" />, label: 'Copilot CLI' },
  grok:       { bg: 'linear-gradient(135deg, #e8e8e8, #999)', icon: <XLogo size={24} weight="regular" className="text-gray-200" />, label: 'Grok Build' },
  'kiro-cli': { bg: 'linear-gradient(135deg, #9046ff, #6020cc)', icon: <Cloud size={24} weight="regular" className="text-purple-200" />, label: 'Kiro CLI' },
  agy:        { bg: 'linear-gradient(135deg, #4285f4, #1a50c0)', icon: <ArrowCircleUp size={24} weight="regular" className="text-blue-200" />, label: 'Antigravity CLI' },
  kimi:       { bg: 'linear-gradient(135deg, #c9c3d6, #8a7fa0)', icon: <MoonPh size={24} weight="regular" className="text-violet-200" />, label: 'Kimi Code' },
  opencode:   { bg: 'linear-gradient(135deg, #b0b0b0, #707070)', icon: <BracketsCurly size={24} weight="regular" className="text-gray-200" />, label: 'OpenCode' },
  aider:      { bg: 'linear-gradient(135deg, #44aa44, #228822)', icon: <WrenchPh size={24} weight="regular" className="text-green-200" />, label: 'Aider' },
  qwen:       { bg: 'linear-gradient(135deg, #6600cc, #4400aa)', icon: <BrainPh size={24} weight="regular" className="text-purple-200" />, label: 'Qwen CLI' },
};

function AgentHeader({ agent }: { agent: AgentType }) {
  const { t } = useTranslation();
  const brand = AGENT_BRANDS[agent] ?? AGENT_BRANDS.claude;
  return (
    <div className="flex items-center justify-center w-full py-6" style={{ background: brand.bg }}>
      <span className="text-[28px] font-bold text-white tracking-tight flex items-center gap-2">
        {brand.icon} {brand.label}
      </span>
    </div>
  );
}

const PERM_OPTIONS: { value: PermissionMode; label: string; labelEn: string; desc: string }[] = [
  { value: 'ask', label: 'agent.perm.ask', labelEn: 'Ask', desc: 'Permission mode: ask before editing' },
  { value: 'auto_edit', label: 'agent.perm.auto', labelEn: 'Auto-edit', desc: 'Permission mode: accept edits automatically' },
  { value: 'full_access', label: 'agent.perm.full', labelEn: 'Full access', desc: 'Permission mode: skip all permissions' },
];

const LAUNCH_OPTIONS: { value: LaunchMode; label: string; labelEn: string; icon: React.ReactNode }[] = [
  { value: 'local', label: 'agent.launch.local', labelEn: 'Local', icon: <Laptop size={14} /> },
  { value: 'worktree', label: 'agent.launch.worktree', labelEn: 'Worktree', icon: <GitPullRequestArrow size={14} /> },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  const total = Math.max(0, Math.round(secs));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtNum(n: number): string { return n < 1000 ? String(n) : n < 1e6 ? `${(n/1e3).toFixed(1)}k` : `${(n/1e6).toFixed(1)}M`; }
function fmtBytes(b: number): string { return b < 1024 ? `${b}B` : b < 1024*1024 ? `${(b/1024).toFixed(0)}K` : `${(b/1024/1024).toFixed(1)}M`; }

// ── Kooky ToolCallActivityStrip sub-components ─────────────────────────────

function ToolIcon({ name, size = 11 }: { name: string; size?: number }) {
  const key = name.toLowerCase();
  if (key.includes('bash')) return <SquareTerminal size={size} className="shrink-0" />;
  if (key.includes('edit') || key.includes('write') || key.includes('multiedit')) return <Pencil size={size} className="shrink-0" />;
  if (key.includes('read')) return <FileText size={size} className="shrink-0" />;
  if (key.includes('grep') || key.includes('glob') || key.includes('find') || key.includes('search'))
    return <Search size={size} className="shrink-0" />;
  if (key.includes('web') || key.includes('fetch')) return <Globe size={size} className="shrink-0" />;
  if (key.includes('list') || key.includes('ls')) return <List size={size} className="shrink-0" />;
  return <Box size={size} className="shrink-0" />;
}

function CounterSeg({ icon, count, label, color }: { icon: string; count: number; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label} count: ${count}`}>
      <ToolIcon name={icon} />
      <span className="font-semibold" style={{ color }}>{count}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

// ── FollowUpDock — Plan A input channel (Plan A: only way to talk to agent) ─
//
// kooky supports IME through NSTextInputClient (macOS AppKit native).
// In Tauri webview + xterm.js, no IME bridge exists — CJK/grid input is
// dropped. Plan A: use this React textarea (full IME support via the
// browser's input pipeline) as the only channel for follow-up messages
// while the agent runs. The xterm panel becomes read-only output.
function FollowUpDock({ agent, onSend, disabled }: { agent: AgentType; onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 shrink-0 rounded-md"
      style={{ background: "var(--aegis-surface)", border: "1px solid var(--aegis-border)" }}>
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded text-aegis-text-dim"
        style={{ background: "var(--aegis-elevated)", color: "rgb(var(--aegis-text-secondary))" }}>
        {agent}
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        disabled={disabled}
        placeholder="Type message (Enter to send, Shift+Enter for newline) — IME / 中文 / 宫格 supported"
        className="flex-1 bg-transparent text-[12px] font-mono text-aegis-text placeholder:text-aegis-text-dim/60 outline-none px-2"
      />
      <button type="button" onClick={handleSubmit} disabled={disabled || !text.trim()}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-all"
        style={{ background: text.trim() ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-input))', color: text.trim() ? 'rgb(var(--aegis-on-primary))' : 'rgb(var(--aegis-text-dim))', opacity: text.trim() ? 1 : 0.5, border: text.trim() ? 'none' : '1px solid var(--aegis-border)' }}>
        <Play size={10} fill="currentColor" /> Send
      </button>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PermissionSelector({ perm, onChange, disabled }: { perm: PermissionMode; onChange: (p: PermissionMode) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Permission mode">
      {PERM_OPTIONS.map((o) => (
        <button key={o.value} type="button" disabled={disabled}
          onClick={() => onChange(o.value)}
          title={o.desc}
          className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-all"
          style={{
            background: perm === o.value ? 'rgb(var(--aegis-primary) / 0.12)' : 'rgb(var(--aegis-overlay) / 0.04)',
            color: perm === o.value ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
            border: perm === o.value ? '1px solid rgb(var(--aegis-primary) / 0.25)' : '1px solid transparent',
            opacity: disabled ? 0.5 : 1,
          }}>
          {t(o.label, o.labelEn)}
        </button>
      ))}
    </div>
  );
}

function AgentToggle({ agent, onChange, disabled }: { agent: AgentType; onChange: (a: AgentType) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold">Agent</span>
      <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        {(['claude', 'codex', 'pi'] as AgentType[]).map((a) => (
          <button key={a} type="button" disabled={disabled}
            onClick={() => onChange(a)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-all"
            style={{
              background: agent === a ? 'rgb(var(--aegis-primary) / 0.10)' : 'transparent',
              color: agent === a ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
              borderRight: a === 'claude' ? '1px solid rgb(var(--aegis-border))' : 'none',
              opacity: disabled ? 0.5 : 1,
            }}>
            {a === 'claude' ? <Sparkle size={13} weight="regular" /> : <Robot size={13} weight="regular" />}
            {a === 'claude' ? 'Claude' : 'Codex'}
          </button>
        ))}
      </div>
    </div>
  );
}

function LaunchSelector({ mode, baseBranch, onMode, onBranch, disabled, projectPath }: {
  mode: LaunchMode; baseBranch: string; onMode: (m: LaunchMode) => void;
  onBranch: (b: string) => void; disabled?: boolean; projectPath: string;
}) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const list = await invoke<{ name: string; current: boolean; remote: string | null }[]>('git_list_branches', { projectPath });
      setBranches(list);
      if (!baseBranch) {
        const cur = list.find((b) => b.current);
        if (cur) onBranch(cur.name);
      }
    } catch { /* not a git repo */ }
    finally { setLoading(false); }
  }, [projectPath, baseBranch, onBranch]);

  useEffect(() => { if (mode === 'worktree') load(); }, [mode, load]);

  const filtered = branches.filter((b) => !search || b.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold shrink-0">{t('agent.launch.label', 'Launch')}</span>
      <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        {LAUNCH_OPTIONS.map((o) => (
          <button key={o.value} type="button" disabled={disabled}
            onClick={() => onMode(o.value)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-all"
            style={{
              background: mode === o.value ? 'rgb(var(--aegis-primary) / 0.10)' : 'transparent',
              color: mode === o.value ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
              borderRight: o.value === 'local' ? '1px solid rgb(var(--aegis-border))' : 'none',
            }}>
            {o.icon} {t(o.label, o.labelEn)}
          </button>
        ))}
      </div>
      {mode === 'worktree' && (
        <div className="relative">
          <button type="button" disabled={disabled}
            onClick={() => { setOpen(!open); if (!open) load(); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-mono"
            style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }}>
            <GitBranch size={11} /> {baseBranch || 'main'}
            {loading ? <Loader2 size={11} className="animate-spin" /> : <ChevronDown size={11} />}
          </button>
          {open && (
            <div className="absolute top-full mt-1 left-0 z-50 w-48 rounded-lg overflow-hidden"
              style={{ background: 'rgb(var(--aegis-card))', border: '1px solid rgb(var(--aegis-border))', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
              <div className="px-2 py-1.5 border-b flex items-center gap-1" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
                <Search size={11} className="text-aegis-text-dim" />
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-transparent text-[11px] outline-none text-aegis-text"
                  placeholder="Filter branches…" />
                <button onClick={() => load()} title="Refresh" className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)]"><RefreshCw size={11} className={loading ? 'animate-spin' : ''} /></button>
              </div>
              <div className="max-h-40 overflow-y-auto py-1">
                {filtered.map((b) => (
                  <button key={b.name} type="button"
                    onClick={() => { onBranch(b.name); setOpen(false); setSearch(''); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-start hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text"
                    style={baseBranch === b.name ? { background: 'rgb(var(--aegis-primary)/0.08)' } : {}}>
                    {baseBranch === b.name ? <Check size={11} className="text-aegis-primary" /> : <span className="w-3" />}
                    <span className="font-mono truncate">{b.name}</span>
                    {b.current && <span className="text-[9px] text-aegis-text-dim ml-auto">current</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Session history strip (kooky-style recent sessions) ─────────────────────
//
// Renders a compact horizontal list of recent sessions for the same agent +
// project. Each chip is a one-click "resume" target that hydrates the prompt
// editor with the corresponding --resume/--session flag and the saved ID.
function SessionHistoryStrip({ agent, projectPath, onResume }: {
  agent: AgentType;
  projectPath: string;
  onResume: (cmd: string) => void;
}) {
  const { t } = useTranslation();
  const list = useSessionHistoryStore((s) => s.listForProject);
  const sessions = list(projectPath, 6).filter((e) => e.agent === agent);
  if (sessions.length === 0) return null;

  const timeAgo = (ms: number) => {
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return t('session.justNow', 'just now');
    if (min < 60) return t('session.minAgo', `${min}m ago`);
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('session.hrAgo', `${hr}h ago`);
    return t('session.dayAgo', `${Math.floor(hr / 24)}d ago`);
  };

  return (
    <div className="mx-4 mt-3 px-3 py-2 rounded-lg flex items-center gap-2 flex-wrap"
      style={{ background: 'rgb(var(--aegis-surface))', border: '1px solid rgb(var(--aegis-border))' }}>
      <span className="text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold mr-1">
        {t('session.recent', 'Recent')}
      </span>
      {sessions.map((s) => (
        <button key={s.key}
          onClick={() => s.resumeCommand && onResume(s.resumeCommand)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors"
          style={{
            background: 'rgb(var(--aegis-overlay)/0.04)',
            border: '1px solid rgb(var(--aegis-border))',
            color: 'rgb(var(--aegis-text-secondary))',
          }}
          title={s.sessionPath}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.04)'; }}>
          <RotateCcw size={10} />
          <span className="font-mono">{s.sessionId.slice(0, 8)}</span>
          <span className="text-aegis-text-dim">·</span>
          <span className="text-aegis-text-dim">{timeAgo(s.lastSeen)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function AgentRunView() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialAgent = (params.get('agent') === 'codex' ? 'codex' : 'claude') as AgentType;
  const initialPrompt = params.get('prompt') ?? '';

  // ── Task config state ────────────────────────────────────────────────────
  const [agent, setAgent] = useState<AgentType>(initialAgent);
  const [perm, setPerm] = useState<PermissionMode>('ask');
  const [planMode, setPlanMode] = useState(false);
  const [launchMode, setLaunchMode] = useState<LaunchMode>('local');
  const [baseBranch, setBaseBranch] = useState('');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [projectPath, setProjectPath] = useState('');
  const [attachedImages, setAttachedImages] = useState<ImageAttach[]>([]);
  const [textAttachments, setTextAttachments] = useState<{ text: string; chars: number }[]>([]);
  const [composerExpanded, setComposerExpanded] = useState(false); // ⌘L multi-line mode (kooky-style)
  const [taskId] = useState(() => `task-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);

  // ── Execution state ──────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<StatusIconValue>('idle');
  const [error, setError] = useState<string | null>(null);
  const [worktreeBranch, setWorktreeBranch] = useState<string | null>(null);
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null);
  const [sessionPath, setSessionPath] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [missingClaudeMd, setMissingClaudeMd] = useState(false);

  // ── Tool-call activity (kooky ToolCallActivityStrip model) ───────────────
  // Real-time counts from agent_task_pty backend — Bash / Edit / Read / Other.
  const [toolStats, setToolStats] = useState<ToolStats>({
    bash: 0, edit: 0, read: 0, other: 0, latest: '',
  });
  const [toolEvents, setToolEvents] = useState<ToolCallEvent[]>([]);
  const toolStartedAtRef = useRef<number>(0);
  // Derive individual events from stat transitions (backend sends aggregate counts)
  const prevStatsRef = useRef<ToolStats>({ bash: 0, edit: 0, read: 0, other: 0, latest: '' });
  useEffect(() => {
    const prev = prevStatsRef.current;
    const total = toolStats.bash + toolStats.edit + toolStats.read + toolStats.other;
    const prevTotal = prev.bash + prev.edit + prev.read + prev.other;
    if (total > prevTotal && toolStats.latest) {
      if (!toolStartedAtRef.current) toolStartedAtRef.current = Date.now();
      const ev: ToolCallEvent = {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        toolName: toolStats.latest,
        identifier: toolStats.latest,
        state: 'running',
        startedAt: Date.now(),
        category: (() => {
          const k = toolStats.latest.toLowerCase();
          if (k.includes('bash')) return 'bash';
          if (k.includes('edit') || k.includes('write') || k.includes('multiedit')) return 'edit';
          if (k.includes('read') || k.includes('notebook')) return 'read';
          return 'other';
        })(),
      };
      setToolEvents((prev) => {
        const next = [...prev, ev];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    }
    prevStatsRef.current = toolStats;
  }, [toolStats]);

  // ── Defensive: terminal init failure capture ──────────────────────────────
  const [terminalError, setTerminalError] = useState<string | null>(null);

  // ── Terminal (xterm.js) ──────────────────────────────────────────────────
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const metricsTimerRef = useRef<number | null>(null);

  // ── Terminal output buffer ───────────────────────────────────────────────
  // Channel callbacks can fire BEFORE the xterm instance is mounted (the
  // run_task IPC returns before xterm mounts in the same render frame).
  // Buffer the chunks and flush on every xterm mount so terminal output
  // is never lost across remounts (running → done key change).
  const outputBufferRef = useRef<string>('');
  const termDisposersRef = useRef<Array<() => void>>([]);

  // Ref-mirror of `running` so onData / onResize callbacks inside the
  // terminal-lifecycle useEffect (whose deps are stable) always read the
  // LATEST value, not a stale closure.
  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);
  const replayOutputTo = useCallback((term: XTerm) => {
    if (outputBufferRef.current) term.write(outputBufferRef.current);
  }, []);

  // ── Terminal lifecycle (one xterm per mounted div, isolated) ────────────
  // Guard: the container is flex:1 — React commits it before CSS layout
  // resolves final dimensions. xterm.js throws "dimensions" / "syncScrollArea"
  // errors when opened into a zero-height element. We wait for the first
  // non-zero paint via ResizeObserver before calling term.open().
  useEffect(() => {
    if (!termRef.current) return;
    const container = termRef.current;
    setTerminalError(null);

    let cancelled = false;
    let term: XTerm | null = null;
    let fit: FitAddon | null = null;
    let sizeRo: ResizeObserver | null = null;
    let dataDisp: { dispose(): void } | null = null;
    let bootstrapping = false;

    const bootstrap = async () => {
      if (cancelled || term || bootstrapping) return;
      const r = container.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      bootstrapping = true;

      const deps = await loadTerminalDeps();
      if (cancelled || term) {
        bootstrapping = false;
        return;
      }

      // Container is live — disconnect sizing observer, build xterm.
      sizeRo?.disconnect();
      sizeRo = null;

      try {
        term = new deps.Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          theme: (() => {
            const cs = getComputedStyle(document.documentElement);
            return {
              background: cs.getPropertyValue('--terminal-bg').trim() || '#0d1117',
              foreground: cs.getPropertyValue('--terminal-text').trim() || '#e6edf3',
            };
          })(),
          rows: 30,
          cols: 120,
        });
        fit = new deps.FitAddon();
        term.loadAddon(fit);
        const unicode11 = new deps.Unicode11Addon();
        term.loadAddon(unicode11);
        unicode11.activate(term);
        term.open(container);

        // ── Plan A: xterm is read-only ──────────────────────────────────
        dataDisp = term.onData((data) => {
          if (!runningRef.current) return;
          if (data.length <= 3 && /^[\x00-\x7F]$/.test(data)) return;
          invoke('agent_send_input', { taskId, data }).catch((err) => {
            debugWarn('terminal', '[AgentRunView] paste-forward failed:', err);
          });
        });

        // Dimension guard: only fit when the container has real size.
        // xterm.js "dimensions" / "syncScrollArea" errors fire when
        // fit.fit() runs against a 0×0 container (flex re-layout edge).
        const safeFit = () => {
          const r = container.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          try { fit!.fit(); } catch { /* */ }
        };
        const doFit = () => { safeFit(); };
        requestAnimationFrame(() => { doFit(); setTimeout(doFit, 50); });

        // Replay any output that arrived before this xterm mounted.
        replayOutputTo(term);

        xtermRef.current = term;
        fitRef.current = fit;

        // Resize handling — forward new cols/rows to PTY so agent re-flows.
        const onResize = () => {
          const r = container.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          try {
            fit!.fit();
            if (runningRef.current && term) {
              invoke('agent_resize_pty', {
                taskId, cols: term.cols, rows: term.rows,
              }).catch(() => {});
            }
          } catch { /* */ }
        };
        const liveRo = new ResizeObserver(onResize);
        liveRo.observe(container);
        window.addEventListener('resize', onResize);

        // Stash cleanup handles so the effect teardown can dispose them.
        const cleanup = () => {
          window.removeEventListener('resize', onResize);
          liveRo.disconnect();
        };
        termDisposersRef.current.push(cleanup);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTerminalError(`Terminal init failed: ${msg}`);
        debugError('terminal', '[AgentRunView] Terminal init failed:', err);
      } finally {
        bootstrapping = false;
      }
    }; // bootstrap

    // Try synchronously — container might already have size (e.g. remount).
    void bootstrap();

    // If xterm wasn't opened (container had 0 dimensions), wait for the
    // next non-zero paint via ResizeObserver.
    if (!term) {
      sizeRo = new ResizeObserver(() => { void bootstrap(); });
      sizeRo.observe(container);
    }

    return () => {
      cancelled = true;
      sizeRo?.disconnect();
      if (dataDisp) { try { dataDisp.dispose(); } catch { /* */ } }
      for (const d of termDisposersRef.current) { try { d(); } catch { /* */ } }
      termDisposersRef.current = [];
      try { term?.dispose(); } catch { /* */ }
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [replayOutputTo]);

  const writeTerm = useCallback((chunk: string) => {
    outputBufferRef.current += chunk;
    xtermRef.current?.write(chunk);
  }, []);

  const clearTerm = useCallback(() => {
    outputBufferRef.current = '';
    xtermRef.current?.clear();
  }, []);

  // ── CLAUDE.md check ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectPath || projectPath === '.') return;
    let cancelled = false;
    invoke<string[]>('read_dir_entries', { path: projectPath, maxDepth: 1 })
      .then((entries) => {
        if (cancelled) return;
        const names = new Set((entries ?? []).map((e) => e.split(/[\\/]/).pop() || ''));
        setMissingClaudeMd(!names.has('CLAUDE.md') && !names.has('AGENTS.md'));
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectPath]);

  // ── Session discovery + persistence + metrics ─────────────────────────────
  // kooky-style: each (agent, project, sessionId) is recorded locally so the
  // user can resume across app restarts. The store is in localStorage under
  // the `agent-sessions` key (see sessionHistoryStore).
  const recordSession = useSessionHistoryStore((s) => s.record);
  useEffect(() => {
    const p = listen<{ task_id: string; session_id: string; session_path: string }>('task-session', (e) => {
      if (e.payload.task_id !== taskId || !e.payload.session_path) return;
      setSessionPath(e.payload.session_path);
      const resumeFlag =
        agent === 'claude' ? '--resume'
        : agent === 'pi' ? '--session'
        : null;
      const resumeCommand = resumeFlag ? `${agent} ${resumeFlag} ${e.payload.session_id}` : undefined;
      recordSession({
        agent,
        projectPath,
        sessionId: e.payload.session_id,
        sessionPath: e.payload.session_path,
        resumeCommand,
      });
    });
    return () => { void p.then((u) => u()); };
  }, [taskId, agent, projectPath, recordSession]);

  // ── Tool-call activity listener (kooky ToolCallActivityStrip model) ──────
  useEffect(() => {
    const p = listen<{ task_id: string; bash: number; edit: number; read: number; other: number; latest: string }>(
      'task-toolcall', (e) => {
        if (e.payload.task_id !== taskId) return;
        setToolStats({
          bash: e.payload.bash,
          edit: e.payload.edit,
          read: e.payload.read,
          other: e.payload.other,
          latest: e.payload.latest ?? '',
        });
      },
    );
    return () => { void p.then((u) => u()); };
  }, [taskId]);

  useEffect(() => {
    if (!sessionPath || !running) return;
    const fetch = async () => {
      try { setMetrics(await invoke<SessionMetrics>('read_session_metrics', { sessionPath })); } catch { /* */ }
    };
    fetch();
    metricsTimerRef.current = window.setInterval(fetch, 30_000);
    return () => { if (metricsTimerRef.current) window.clearInterval(metricsTimerRef.current); };
  }, [sessionPath, running]);

  // ── Start / Cancel ───────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!prompt.trim() || running) return;
    setError(null); clearTerm(); setStatus('running'); setRunning(true); setMetrics(null); setDiffStats(null);

    const onOutput = new Channel<string>();
    onOutput.onmessage = (chunk) => writeTerm(chunk);

    try {
      let actualPath = projectPath || '.';
      if (launchMode === 'worktree') {
        const result = await invoke<{ path: string; branch: string }>('create_task_worktree', { projectPath: actualPath, taskId, baseBranch: baseBranch || undefined });
        actualPath = result.path; setWorktreeBranch(result.path);
      }
      await invoke('run_task', { taskId, projectPath: actualPath, prompt, agent, permissionMode: perm, cols: 220, rows: 50, onOutput, resumeId: resumeIdRef.current });
      setStatus('done');
      if (launchMode === 'worktree' && worktreeBranch) {
        try {
          const s = await invoke<{ additions: number; deletions: number }>('worktree_diff_stats', { worktreePath: worktreeBranch, baseBranch: baseBranch || 'main' });
          setDiffStats(s);
        } catch { /* */ }
      }
    } catch (e) { setError(String(e)); setStatus('failed'); }
    finally { setRunning(false); }
  }, [prompt, running, agent, perm, projectPath, launchMode, baseBranch, taskId, worktreeBranch, writeTerm, clearTerm]);

  const handleCancel = useCallback(async () => {
    try { await invoke('cancel_task', { taskId }); setStatus('cancelled'); } catch (e) { setError(String(e)); } finally { setRunning(false); }
  }, [taskId]);

  // ── Worktree actions ─────────────────────────────────────────────────────
  const mergeWorktree = async () => {
    if (!worktreeBranch) return;
    try { await invoke('merge_task_worktree', { projectPath: projectPath || '.', taskWorktreePath: worktreeBranch }); setDiffStats(null); } catch (e) { setError(String(e)); }
  };
  const discardWorktree = async () => {
    if (!worktreeBranch) return;
    try { await invoke('remove_task_worktree', { taskWorktreePath: worktreeBranch }); setDiffStats(null); setWorktreeBranch(null); } catch (e) { setError(String(e)); }
  };

  const isDone = status === 'done' || status === 'failed' || status === 'cancelled';

  // Mark running tool events as done/error on task end (kooky PreToolUse/PostToolUse pattern)
  useEffect(() => {
    if (!isDone) return;
    setToolEvents((prev) =>
      prev.map((ev) => (ev.state === 'running' ? { ...ev, state: status === 'done' ? 'done' as const : 'error' as const, endedAt: Date.now() } : ev)),
    );
  }, [isDone, status]);

  // ── Resume support ──────────────────────────────────────────────────────
  const resumeFlag = agent === 'claude' ? '--resume' : agent === 'pi' ? '--session' : null;
  const canResume = !running && isDone && !!sessionPath && !!resumeFlag && status === 'done';
  const resumeIdRef = useRef<string | null>(null);

  const handleResume = useCallback(() => {
    const sessionId = sessionPath?.split('/').pop()?.replace('.jsonl', '') ?? '';
    resumeIdRef.current = sessionId;
    setStatus('idle'); setRunning(false); setError(null); setMetrics(null); setDiffStats(null);
    setPrompt(`[Resuming conversation ${sessionId}]`);
  }, [sessionPath]);

  useEffect(() => { if (prompt === '' && resumeIdRef.current) resumeIdRef.current = null; }, [prompt]);

  // ── Save as Todo (localStorage) ─────────────────────────────────────────
  const handleSaveTodo = useCallback(() => {
    if (!prompt.trim() && textAttachments.length === 0) return;
    const todos = JSON.parse(localStorage.getItem('junqi:saved-todos') || '[]');
    todos.push({ at: Date.now(), agent, prompt, perm, textChars: textAttachments.map(t => t.text) });
    localStorage.setItem('junqi:saved-todos', JSON.stringify(todos.slice(-20)));
    setPrompt(''); setAttachedImages([]); setTextAttachments([]);
  }, [prompt, agent, perm, textAttachments]);

  // ── Xterm re-fit on done ────────────────────────────────────────────────
  useEffect(() => {
    if (isDone && fitRef.current && termRef.current?.getBoundingClientRect) {
      const r = (termRef.current as HTMLElement).getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      setTimeout(() => { try { fitRef.current!.fit(); } catch { /* */ } }, 100);
    }
  }, [isDone]);

  // ── Tool-call indicator (for agents that report tool calls) ─────────────
  const agentSpec = { claude: true, codex: false, pi: true }[agent];
  const showToolPill = agentSpec && metrics && metrics.tool_calls > 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'rgb(var(--aegis-bg))' }}>
      {/* ── Header: agent GIF + status ────────────────────────────────── */}
      {!running && !isDone && <AgentHeader agent={agent} />}
      {/* ── Session history (kooky-style recent list) ─────────────────── */}
      {!running && !isDone && <SessionHistoryStrip agent={agent} projectPath={projectPath} onResume={(cmd) => {
        const m = cmd.match(/(claude|pi)\s+(?:--resume|--session)\s+(\S+)/);
        if (m) {
          resumeIdRef.current = m[2];
          setStatus('idle');
          setError(null);
          setPrompt(`[Resuming ${agent} session ${m[2]}]`);
        }
      }} />}
      {running && (
        <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ background: 'rgb(var(--aegis-primary)/0.06)', borderColor: 'rgb(var(--aegis-border))' }}>
          <StatusBadge state="running" size={10} />
          <span className="text-[12px] font-semibold text-aegis-text">Agent running</span>
          <StatusIcon status={status} size={13} />
          <span className="ml-auto text-[10px] font-mono text-aegis-text-dim">{taskId}</span>
        </div>
      )}

      {/* ── Missing-file warning ──────────────────────────────────────── */}
      {missingClaudeMd && !running && !isDone && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg flex items-center gap-2 text-[12px]"
          style={{ background: 'rgb(var(--aegis-warning)/0.06)', border: '1px solid rgb(var(--aegis-warning)/0.2)', color: 'rgb(var(--aegis-warning))' }}>
          <FileWarning size={14} className="shrink-0" />
          <span>No CLAUDE.md found. Create one to help the agent understand your project.</span>
        </div>
      )}

      {/* ── Scrollable body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Config bar (nezha-style toolbar) ────────────────────────── */}
        {!running && !isDone && (
          <div className="px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <AgentToggle agent={agent} onChange={setAgent} disabled={running} />
              <PermissionSelector perm={perm} onChange={setPerm} disabled={running} />
            </div>
            <div className="flex items-center gap-2">
              <input value={projectPath} onChange={(e) => setProjectPath(e.target.value)}
                placeholder="Project path (cwd if empty)" disabled={running}
                className="flex-1 px-2.5 py-1.5 rounded-md text-[12px] font-mono"
                style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <LaunchSelector mode={launchMode} baseBranch={baseBranch}
                onMode={setLaunchMode} onBranch={setBaseBranch} disabled={running} projectPath={projectPath} />
              <label className="flex items-center gap-1.5 text-[12px] text-aegis-text-dim cursor-pointer select-none">
                <input type="checkbox" checked={planMode} onChange={(e) => setPlanMode(e.target.checked)} disabled={running}
                  className="w-3.5 h-3.5 rounded accent-aegis-primary" />
                Plan mode
              </label>
            </div>
          </div>
        )}

        {/* ── Prompt editor ───────────────────────────────────────────── */}
        {!running && !isDone && (
          <div className="px-4 pb-3">
            <PromptEditor
              value={prompt} onChange={setPrompt} onSubmit={handleStart} submitHint=""
              placeholder="What should the agent do? type @ to mention a file, drag images here (⌘L expands)"
              rows={4} disabled={running} draftKey="agent-run"
              expanded={composerExpanded} onExpandedChange={setComposerExpanded}
              images={attachedImages} onAttachImages={setAttachedImages}
              onRemoveImage={(i) => setAttachedImages((p) => p.filter((_, idx) => idx !== i))}
              onLargePaste={(text) => setTextAttachments((prev) => [...prev, { text, chars: text.length }])} />
          </div>
        )}

        {/* ── Text attachments ──────────────────────────────────────── */}
        {!running && !isDone && textAttachments.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {textAttachments.map((ta, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px]"
                style={{ background: 'rgb(var(--aegis-overlay)/0.05)', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text-secondary))' }}>
                <FileText size={11} className="text-aegis-text-dim" />
                <span>Text attachment · {ta.chars > 1000 ? `${(ta.chars/1000).toFixed(1)}K` : ta.chars} chars</span>
                <button type="button" onClick={() => setTextAttachments((p) => p.filter((_, idx) => idx !== i))}
                  className="ml-1 p-0.5 rounded hover:bg-[rgb(var(--aegis-danger)/0.1)] text-aegis-text-dim hover:text-aegis-danger">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Send / Cancel bar ───────────────────────────────────────── */}
        {!running && !isDone && (
          <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
            <button type="button" onClick={handleStart}
              disabled={!prompt.trim() && textAttachments.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-bold transition-all"
              style={{ background: 'rgb(var(--aegis-primary))', color: 'rgb(var(--aegis-on-primary))', opacity: prompt.trim() || textAttachments.length > 0 ? 1 : 0.4 }}>
              <Play size={14} fill="currentColor" /> Send
            </button>
            <button type="button" onClick={handleSaveTodo}
              disabled={!prompt.trim() && textAttachments.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
              <Bookmark size={13} /> Save as Todo
            </button>
            {attachedImages.length > 0 && (
              <button type="button" onClick={() => setAttachedImages([])}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-aegis-text-dim hover:text-aegis-danger">
                <X size={12} /> Clear images ({attachedImages.length})
              </button>
            )}
          </div>
        )}

        {/* ── Running: minimal terminal + plan-A input dock ───────────── */}
        {running && (
          <div className="flex-1 flex flex-col min-h-0 px-4 pb-2 gap-1">
            {terminalError ? (
              <div className="flex-1 flex items-center justify-center p-4 rounded text-center"
                style={{ background: 'var(--terminal-bg)', border: '1px solid rgb(var(--aegis-danger))', minHeight: 300, color: 'rgb(var(--aegis-danger))' }}>
                <div>
                  <AlertCircle size={32} className="mx-auto mb-2 opacity-70" />
                  <div className="text-[12px] font-semibold mb-1">Terminal failed to initialize</div>
                  <div className="text-[11px] font-mono opacity-70">{terminalError}</div>
                </div>
              </div>
            ) : (
              <div key="running" ref={termRef} className="flex-1 overflow-hidden rounded"
                style={{ background: "var(--terminal-bg)", border: "1px solid var(--terminal-border)", padding: 8, minHeight: 300 }} />
            )}
            <FollowUpDock
              agent={agent}
              onSend={(text) => {
                if (!text.trim()) return;
                invoke('agent_send_input', { taskId, data: text + '\n' }).catch((err) => {
                  debugWarn('terminal', '[AgentRunView] follow-up send failed:', err);
                });
              }}
              disabled={false}
            />
          </div>
        )}

        {/* ── Done: kooky-style terminal + actions ──────────────────────── */}
        {isDone && (
          <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-1">
            {resumeIdRef.current && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono" style={{ background: 'var(--aegis-surface)', border: '1px solid var(--aegis-border)', color: 'rgb(var(--aegis-success))' }}>
                <RotateCcw size={11} /> resume: {resumeIdRef.current}
              </div>
            )}
            {/* Terminal — separate instance with distinct key */}
            <div key="done" ref={termRef} className="flex-1 overflow-hidden"
              style={{ background: "var(--terminal-bg)", border: "1px solid var(--terminal-border)", minHeight: 200 }} />
            {/* Status bar (kooky PaneStatusBar) */}
            <div className="flex items-center gap-3 px-2.5 h-8 shrink-0"
              style={{ background: 'var(--aegis-surface)', border: '1px solid var(--aegis-border)' }}>
              {/* Left: kooky-aligned 4-state lifecycle badge */}
              {(() => {
                const lc: LifecycleState =
                  status === 'done' ? 'ended'
                  : status === 'failed' ? 'failed'
                  : status === 'cancelled' ? 'idle'
                  : status === 'running' ? 'running'
                  : 'idle';
                return <StatusBadge state={lc} label labelText={t(`agent.status.${status}`, status)} />;
              })()}
              {/* Center: metrics + actions */}
              <span className="flex items-center gap-3 ml-auto text-[10px] font-mono tabular-nums text-[rgb(var(--aegis-text-dim))]">
                {metrics && (
                  <>
                    {metrics.duration_secs > 0 && <span>{formatDuration(metrics.duration_secs)}</span>}
                    {metrics.total_tokens > 0 && <span className="text-[rgb(var(--aegis-primary))]">{fmtNum(metrics.total_tokens)} tok</span>}
                    {/* Kooky ToolCallActivityPill — clickable pill + history popover */}
                    {showToolPill && (
                      <ToolCallActivityPill
                        stats={toolStats}
                        events={toolEvents}
                        sessionStartedAt={toolStartedAtRef.current || Date.now()}
                      />
                    )}
                    {metrics.session_file_bytes > 0 && <span>{fmtBytes(metrics.session_file_bytes)}</span>}
                    <span className="text-[rgb(var(--aegis-text-dim))]">·</span>
                  </>
                )}
                {worktreeBranch && diffStats && (
                  <>
                    <span className="text-[rgb(var(--aegis-success))]">+{diffStats.additions}</span>
                    <span className="text-[rgb(var(--aegis-danger))]">−{diffStats.deletions}</span>
                    <button onClick={mergeWorktree} className="hover:text-[rgb(var(--aegis-success))] transition-colors">{t('agent.worktree.merge', 'merge')}</button>
                    <button onClick={discardWorktree} className="hover:text-[rgb(var(--aegis-danger))] transition-colors">{t('agent.worktree.discard', 'discard')}</button>
                    <span className="text-[rgb(var(--aegis-text-dim))]">·</span>
                  </>
                )}
                {sessionPath && (
                  <>
                    <button onClick={() => navigate(`/session?path=${encodeURIComponent(sessionPath)}`)} title={sessionPath}
                      className="hover:text-[rgb(var(--aegis-primary))] transition-colors">{t('agent.session.view', 'session')}</button>
                    {canResume && <button onClick={handleResume} className="hover:text-[rgb(var(--aegis-success))] transition-colors">{t('agent.session.resume', 'resume')}</button>}
                    <span className="text-[rgb(var(--aegis-text-dim))]">·</span>
                  </>
                )}
              </span>
              {/* Right: new task */}
              <button type="button" onClick={() => { setStatus('idle'); setRunning(false); setError(null); setMetrics(null); setSessionPath(null); setDiffStats(null); clearTerm(); }}
                className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-[var(--aegis-hover)] text-[rgb(var(--aegis-text-dim))] hover:text-[rgb(var(--aegis-text))]">
                <RotateCcw size={12} />
              </button>
            </div>
          </div>
        )}

        {/* ── Error banner ────────────────────────────────────────────── */}
        {error && (
          <div className="mx-4 mb-3 px-3 py-2 rounded-lg flex items-start gap-2 text-[12px]"
            style={{ background: 'rgb(var(--aegis-danger)/0.08)', border: '1px solid rgb(var(--aegis-danger)/0.2)', color: 'rgb(var(--aegis-danger))' }}>
            <AlertCircle size={14} className="mt-[1px] shrink-0" />
            <span className="font-mono break-all text-[11px] flex-1">{error}</span>
            <button onClick={() => setError(null)} className="p-0.5 rounded hover:bg-[rgb(var(--aegis-danger)/0.1)]"><X size={13} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentRunView;
