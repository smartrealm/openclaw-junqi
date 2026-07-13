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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import {
  Play, Square, RotateCcw, ChevronDown, ChevronRight, AlertCircle,
  ExternalLink, GitBranch, GitMerge, Trash2, Clock,
  Loader2, BarChart3, FileText, CheckCircle2, XCircle,
  Activity, FileWarning, FilePlus2, Image as ImageIcon, Bookmark, Command,
  CornerDownLeft, Laptop, GitPullRequestArrow, Plus, RefreshCw,
  Search, X, Check, Globe, List, Box, SquareTerminal, Pencil, Folder, Download, Copy,
} from 'lucide-react';
import {
  Sparkle,
  Robot,
} from '@phosphor-icons/react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PromptEditor, type ImageAttach } from '@/components/shared/PromptEditor';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  useAgentWorkspaceStore,
  shouldIgnoreAgentWorkspaceTaskStatusTransition,
  type AgentWorkspaceTask,
  type AgentWorkspaceTaskStatus,
} from '@/stores/agentWorkspaceStore';
import { StatusIcon } from '@/components/shared/StatusIcon';
import { StatusBadge, type LifecycleState } from '@/components/shared/StatusBadge';
import { SessionViewPage } from '@/pages/SessionViewPage';
import { ToolCallActivityPill, type ToolCallEvent, type ToolStats } from '@/components/shared/ToolCallHistoryPopover';
import { useSessionHistoryStore } from '@/stores/sessionHistoryStore';
import { debugError, debugWarn } from '@/utils/debugLog';
import { attachSmartCopy } from '@/components/Terminal/terminalCopyHelper';
import { attachLinuxIMEFix, attachMacWebKitShiftInputFix } from '@/components/Terminal/terminalInputFix';
import {
  applyTerminalFontFamily,
  applyTerminalFontSize,
  applyTerminalThemeOnPanel,
  attachTerminalScrollbarAutoHide,
  loadWebglAddon,
  refreshTerminalDisplay,
} from '@/components/Terminal/terminalShared';
import type { FontFamily, TerminalFontSize, ThemeVariant } from '@/components/Terminal/_nezha-types';
import { getDefaultMonoFont } from '@/components/Terminal/_nezha-types';
import {
  DEFAULT_SHIFT_ENTER_NEWLINE,
  matchesTerminalNewline,
  normalizeShiftEnterNewline,
  TERMINAL_NEWLINE_SEQUENCE,
} from '@/_nezha_root/shortcuts';
import { createTaskWorktreeArgs, mergeTaskWorktreeArgs, taskWorktreeArgs, worktreeDiffStatsArgs } from './agentWorktreeCommands';
import { applyPlanModePrompt } from './agentPrompt';
import claudeGif from '@/assets/gif/claude.gif';
import codexGif from '@/assets/gif/codex.gif';
import { captureTaskNameSnapshot, taskStillMatchesNameSnapshot } from './AgentWorkspace/taskNameGuard';

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

export type AgentRunAgent = 'claude' | 'codex' | 'pi';
type AgentType = AgentRunAgent;
export type AgentRunPermissionMode = 'ask' | 'auto_edit' | 'full_access';
type PermissionMode = AgentRunPermissionMode;
type LaunchMode = 'local' | 'worktree';
type AgentWorkspaceTaskPatch = Partial<Omit<AgentWorkspaceTask, 'id' | 'createdAt' | 'status'>>;

interface SessionMetrics {
  tool_calls: number;
  duration_secs: number;
  session_file_bytes: number;
  total_tokens: number;
  context_tokens: number;
  context_window: number;
}

interface HookAgentReadiness {
  agent: 'claude' | 'codex';
  usable: boolean;
  reason?: 'version_too_low' | 'no_node' | 'not_installed';
  detected_version?: string;
  min_version?: string;
}

function isActiveWorkspaceTaskStatus(status: AgentWorkspaceTaskStatus | undefined): boolean {
  return status === 'running'
    || status === 'input_required'
    || status === 'awaiting_review'
    || status === 'detached'
    || status === 'interrupted';
}

// ── Constants ──────────────────────────────────────────────────────────────

function AgentHeader({ agent }: { agent: AgentType }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full shrink-0 flex-col items-center justify-center pb-2 pt-5">
      <img
        src={agent === 'codex' ? codexGif : claudeGif}
        alt=""
        className="mb-2 h-auto w-[min(112px,28vw)] object-contain"
      />
      <span className="text-xl font-bold text-aegis-text">
        {t('newTask.title', '新建任务')}
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

function AgentToggle({ agent, onChange, disabled, allowPi = false }: { agent: AgentType; onChange: (a: AgentType) => void; disabled?: boolean; allowPi?: boolean }) {
  const agents: AgentType[] = allowPi ? ['claude', 'codex', 'pi'] : ['claude', 'codex'];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold">Agent</span>
      <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        {agents.map((a) => (
          <button key={a} type="button" disabled={disabled}
            onClick={() => onChange(a)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-all"
            style={{
              background: agent === a ? 'rgb(var(--aegis-primary) / 0.10)' : 'transparent',
              color: agent === a ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
              borderRight: a !== agents.at(-1) ? '1px solid rgb(var(--aegis-border))' : 'none',
              opacity: disabled ? 0.5 : 1,
            }}>
            {a === 'claude' ? <Sparkle size={13} weight="regular" /> : <Robot size={13} weight="regular" />}
            {a === 'claude' ? 'Claude' : a === 'codex' ? 'Codex' : 'Pi'}
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
  const baseBranchRef = useRef(baseBranch);
  const onBranchRef = useRef(onBranch);
  baseBranchRef.current = baseBranch;
  onBranchRef.current = onBranch;

  const load = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const list = await invoke<{ name: string; current: boolean; remote: string | null }[]>('git_list_branches', { projectPath });
      setBranches(list);
      if (!baseBranchRef.current) {
        const cur = list.find((b) => b.current);
        if (cur) onBranchRef.current(cur.name);
      }
    } catch { /* not a git repo */ }
    finally { setLoading(false); }
  }, [projectPath]);

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
            <GitBranch size={11} /> {baseBranch || '选择基础分支'}
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

// ── Main Component ─────────────────────────────────────────────────────────

export interface AgentRunViewProps {
  taskId?: string;
  initialTitle?: string;
  projectPath?: string;
  agent?: AgentRunAgent;
  prompt?: string;
  permissionMode?: PermissionMode;
  initialStatus?: AgentWorkspaceTaskStatus;
  initialSessionPath?: string;
  initialSessionId?: string;
  /** Persisted worktree for a task reopened after a project switch or restart. */
  initialWorktreePath?: string;
  initialWorktreeBranch?: string;
  initialWorktreeDiscarded?: boolean;
  initialBaseBranch?: string;
  initialPlanMode?: boolean;
  initialLaunchMode?: LaunchMode;
  initialIsDraft?: boolean;
  autoStart?: boolean;
  onTaskStarted?: () => void;
  onTaskSaved?: () => void;
  onOpenWorktreeTerminal?: () => void;
  terminalScrollback?: number;
  terminalFontSize?: TerminalFontSize;
  monoFontFamily?: FontFamily;
  themeVariant?: ThemeVariant;
}

export function AgentRunView({
  taskId: providedTaskId,
  initialTitle = '',
  projectPath: providedProjectPath,
  agent: providedAgent,
  prompt: providedPrompt,
  permissionMode: providedPermissionMode,
  initialStatus: providedInitialStatus,
  initialSessionPath: providedInitialSessionPath,
  initialSessionId: providedInitialSessionId,
  initialWorktreePath: providedInitialWorktreePath,
  initialWorktreeBranch: providedInitialWorktreeBranch,
  initialWorktreeDiscarded = false,
  initialBaseBranch: providedInitialBaseBranch,
  initialPlanMode: providedInitialPlanMode = false,
  initialLaunchMode: providedInitialLaunchMode,
  initialIsDraft = false,
  autoStart = false,
  onTaskStarted,
  onTaskSaved,
  onOpenWorktreeTerminal,
  terminalScrollback = 1000,
  terminalFontSize = 12,
  monoFontFamily = getDefaultMonoFont(),
  themeVariant = 'dark',
}: AgentRunViewProps = {}) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const updateWorkspaceTask = useAgentWorkspaceStore((state) => state.updateTask);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const mentionProjects = useMemo(() => workspaces
    .filter((workspace) => !workspace.sshRemoteHost)
    .map((workspace) => ({
      name: workspace.name,
      path: workspace.projectDirectory || workspace.workingDirectory,
    }))
    .filter((workspace) => Boolean(workspace.path)), [workspaces]);
  const requestedAgent = providedAgent ?? params.get('agent');
  const initialAgent: AgentType = requestedAgent === 'codex' || requestedAgent === 'pi'
    ? requestedAgent
    : 'claude';
  const initialPrompt = providedPrompt ?? params.get('prompt') ?? '';
  const initiallyActive = isActiveWorkspaceTaskStatus(providedInitialStatus);

  // ── Task config state ────────────────────────────────────────────────────
  const [agent, setAgent] = useState<AgentType>(initialAgent);
  const [perm, setPerm] = useState<PermissionMode>(providedPermissionMode ?? 'ask');
  const [planMode, setPlanMode] = useState(providedInitialPlanMode);
  const [launchMode, setLaunchMode] = useState<LaunchMode>(providedInitialLaunchMode ?? (providedInitialWorktreePath && !initialWorktreeDiscarded ? 'worktree' : 'local'));
  const [baseBranch, setBaseBranch] = useState(providedInitialBaseBranch ?? '');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [taskTitle, setTaskTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  useEffect(() => {
    setTaskTitle(initialTitle);
    if (!editingTitle) setTitleDraft(initialTitle);
  }, [editingTitle, initialTitle]);
  const [projectPath, setProjectPath] = useState(() => {
    const requestedPath = providedProjectPath ?? params.get('projectPath');
    if (requestedPath) return requestedPath;
    const workspaceState = useWorkspaceStore.getState();
    const activeWorkspace = workspaceState.workspaces.find(
      (workspace) => workspace.id === workspaceState.activeWorkspaceId,
    );
    return activeWorkspace?.projectDirectory ?? activeWorkspace?.workingDirectory ?? '';
  });
  const [attachedImages, setAttachedImages] = useState<ImageAttach[]>([]);
  const [textAttachments, setTextAttachments] = useState<{ text: string; chars: number }[]>([]);
  const [composerExpanded, setComposerExpanded] = useState(false); // ⌘L multi-line mode (kooky-style)
  const draftUserEditedRef = useRef(false);
  const [taskId] = useState(() => providedTaskId?.trim() || params.get('taskId')?.trim() || `task-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const workspaceTaskId = providedTaskId?.trim() || params.get('taskId')?.trim() || null;

  // Match Nezha's fresh-task behavior: a project can supply default agent and
  // permission mode. Never apply it to an existing or edited task.
  useEffect(() => {
    if (!initialIsDraft || initialPrompt.trim() || !projectPath) return;
    let cancelled = false;
    void invoke<{ agent?: { default?: string; default_permission_mode?: string } }>('read_project_config', { projectPath })
      .then((config) => {
        if (cancelled || draftUserEditedRef.current) return;
        const defaultAgent = config.agent?.default;
        if (defaultAgent === 'claude' || defaultAgent === 'codex' || defaultAgent === 'pi') setAgent(defaultAgent);
        const defaultPermission = config.agent?.default_permission_mode;
        if (defaultPermission === 'ask' || defaultPermission === 'auto_edit' || defaultPermission === 'full_access') {
          setPerm(defaultPermission);
        }
      })
      .catch(() => { /* project config is optional */ });
    return () => { cancelled = true; };
  }, [initialIsDraft, initialPrompt, projectPath]);

  const updateWorkspaceTaskState = useCallback(
    (nextStatus: AgentWorkspaceTaskStatus, patch: AgentWorkspaceTaskPatch = {}) => {
      if (!workspaceTaskId) return;
      updateWorkspaceTask(workspaceTaskId, {
        status: nextStatus,
        attentionRequestedAt: nextStatus === 'input_required' || nextStatus === 'awaiting_review'
          ? Date.now()
          : undefined,
        ...patch,
      });
    },
    [updateWorkspaceTask, workspaceTaskId],
  );

  // ── Execution state ──────────────────────────────────────────────────────
  const [running, setRunning] = useState(initiallyActive);
  const [status, setStatus] = useState<AgentWorkspaceTaskStatus | 'idle'>(initiallyActive ? providedInitialStatus! : 'idle');
  const statusRef = useRef(status);
  statusRef.current = status;
  const [error, setError] = useState<string | null>(null);
  const restoredWorktreePath = initialWorktreeDiscarded ? null : providedInitialWorktreePath ?? null;
  const [worktreePath, setWorktreePath] = useState<string | null>(restoredWorktreePath);
  const worktreePathRef = useRef<string | null>(restoredWorktreePath);
  const [worktreeBranch, setWorktreeBranch] = useState<string | null>(initialWorktreeDiscarded ? null : providedInitialWorktreeBranch ?? null);
  const [worktreeDiscarded, setWorktreeDiscarded] = useState(initialWorktreeDiscarded);
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState<'merge' | 'discard' | null>(null);
  const [sessionPath, setSessionPath] = useState<string | null>(providedInitialSessionPath ?? null);
  const [sessionId, setSessionId] = useState<string | null>(providedInitialSessionId ?? null);
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [sessionPathCopied, setSessionPathCopied] = useState(false);
  const [exportingSession, setExportingSession] = useState(false);
  const [missingInstructionsFile, setMissingInstructionsFile] = useState(false);
  const [hookReadiness, setHookReadiness] = useState<HookAgentReadiness[] | null>(null);

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
  const shiftEnterNewlineRef = useRef(DEFAULT_SHIFT_ENTER_NEWLINE);
  const terminalScrollbackRef = useRef(terminalScrollback);
  terminalScrollbackRef.current = terminalScrollback;

  // ── Terminal output buffer ───────────────────────────────────────────────
  // Channel callbacks can fire BEFORE the xterm instance is mounted (the
  // run_task IPC returns before xterm mounts in the same render frame).
  // Buffer the chunks and flush on every xterm mount so terminal output
  // is never lost across remounts (running → done key change).
  const outputBufferRef = useRef<string>('');
  const outputChannelOwnedRef = useRef(false);
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
    let disposeSmartCopy: (() => void) | null = null;
    let disposeMacInputFix: (() => void) | null = null;
    let disposeScrollbar: (() => void) | null = null;
    let webglHandle: { dispose(): void } | null = null;
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
          fontSize: terminalFontSize,
          fontFamily: monoFontFamily,
          theme: (() => {
            const cs = getComputedStyle(document.documentElement);
            return {
              background: cs.getPropertyValue('--terminal-bg').trim() || '#0d1117',
              foreground: cs.getPropertyValue('--terminal-text').trim() || '#e6edf3',
            };
          })(),
          rows: 30,
          cols: 120,
          scrollback: terminalScrollbackRef.current,
        });
        fit = new deps.FitAddon();
        term.loadAddon(fit);
        const unicode11 = new deps.Unicode11Addon();
        term.loadAddon(unicode11);
        unicode11.activate(term);
        term.open(container);

        const sendTerminalInput = (data: string) => {
          if (!runningRef.current) return;
          invoke('agent_send_input', { taskId, data }).catch((err) => {
            debugWarn('terminal', '[AgentRunView] terminal input failed:', err);
          });
        };
        dataDisp = attachLinuxIMEFix(term, sendTerminalInput);
        disposeMacInputFix = attachMacWebKitShiftInputFix(term);
        disposeSmartCopy = attachSmartCopy(term, {
          matchesNewline: (event) => matchesTerminalNewline(event, shiftEnterNewlineRef.current),
          onNewline: () => sendTerminalInput(TERMINAL_NEWLINE_SEQUENCE),
        });
        disposeScrollbar = attachTerminalScrollbarAutoHide(term, container);
        webglHandle = loadWebglAddon(term);

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
      try { disposeSmartCopy?.(); } catch { /* */ }
      try { disposeMacInputFix?.(); } catch { /* */ }
      try { disposeScrollbar?.(); } catch { /* */ }
      try { webglHandle?.dispose(); } catch { /* */ }
      for (const d of termDisposersRef.current) { try { d(); } catch { /* */ } }
      termDisposersRef.current = [];
      try { term?.dispose(); } catch { /* */ }
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [replayOutputTo, status]);

  useEffect(() => {
    if (!xtermRef.current || !fitRef.current || !termRef.current) return;
    const size = applyTerminalFontSize(xtermRef.current, fitRef.current, terminalFontSize, termRef.current);
    if (size && runningRef.current) {
      void invoke('agent_resize_pty', { taskId, cols: size.cols, rows: size.rows }).catch(() => undefined);
    }
  }, [taskId, terminalFontSize]);

  useEffect(() => {
    if (!xtermRef.current || !fitRef.current || !termRef.current) return;
    const result = applyTerminalFontFamily(xtermRef.current, fitRef.current, monoFontFamily, termRef.current);
    if (result?.immediate && runningRef.current) {
      void invoke('agent_resize_pty', { taskId, cols: result.immediate.cols, rows: result.immediate.rows }).catch(() => undefined);
    }
    void result?.whenSettled.then((size) => {
      if (size && runningRef.current) {
        void invoke('agent_resize_pty', { taskId, cols: size.cols, rows: size.rows }).catch(() => undefined);
      }
    });
  }, [monoFontFamily, taskId]);

  useEffect(() => {
    if (!xtermRef.current || !termRef.current) return;
    applyTerminalThemeOnPanel(xtermRef.current, themeVariant, termRef.current);
    refreshTerminalDisplay(xtermRef.current);
  }, [themeVariant]);

  useEffect(() => {
    const loadNewlineSetting = () => {
      void invoke<{ terminal_shift_enter_newline?: unknown }>('load_app_settings')
        .then((settings) => {
          shiftEnterNewlineRef.current = normalizeShiftEnterNewline(settings.terminal_shift_enter_newline);
        })
        .catch(() => {
          shiftEnterNewlineRef.current = DEFAULT_SHIFT_ENTER_NEWLINE;
        });
    };
    loadNewlineSetting();
    window.addEventListener('nezha:app-settings-changed', loadNewlineSetting);
    return () => window.removeEventListener('nezha:app-settings-changed', loadNewlineSetting);
  }, []);

  const writeTerm = useCallback((chunk: string) => {
    outputBufferRef.current += chunk;
    xtermRef.current?.write(chunk);
  }, []);

  const clearTerm = useCallback(() => {
    outputBufferRef.current = '';
    xtermRef.current?.clear();
  }, []);

  // A task can keep running after the route unmounts. On return, replay the
  // bounded native snapshot and subscribe to the shared output event stream.
  useEffect(() => {
    if (!workspaceTaskId || !initiallyActive || outputChannelOwnedRef.current) return;
    let disposed = false;
    void invoke<string>('get_task_output_snapshot', { taskId }).then((snapshot) => {
      if (!disposed && snapshot) writeTerm(snapshot);
    }).catch(() => undefined);
    const subscription = listen<{ task_id: string; output: string }>('task-output', (event) => {
      if (event.payload.task_id === taskId && event.payload.output) writeTerm(event.payload.output);
    });
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten());
    };
  }, [initiallyActive, taskId, workspaceTaskId, writeTerm]);

  // ── Agent instruction-file check ─────────────────────────────────────────
  useEffect(() => {
    if (!projectPath || projectPath === '.') return;
    let cancelled = false;
    const instructionsFile = agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
    invoke<string[]>('read_dir_entries', { path: projectPath, maxDepth: 1 })
      .then((entries) => {
        if (cancelled) return;
        const names = new Set((entries ?? []).map((e) => e.split(/[\\/]/).pop() || ''));
        setMissingInstructionsFile(!names.has(instructionsFile));
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [agent, projectPath]);

  // Hooks enrich the live task timeline but are deliberately non-blocking:
  // agents still run through the PTY fallback when they are unavailable.
  useEffect(() => {
    let cancelled = false;
    void invoke<HookAgentReadiness[]>('get_hook_readiness')
      .then((readiness) => {
        if (!cancelled) setHookReadiness(readiness);
      })
      .catch(() => {
        if (!cancelled) setHookReadiness([]);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Session discovery + persistence + metrics ─────────────────────────────
  // kooky-style: each (agent, project, sessionId) is recorded locally so the
  // user can resume across app restarts. The store is in localStorage under
  // the `agent-sessions` key (see sessionHistoryStore).
  const recordSession = useSessionHistoryStore((s) => s.record);
  useEffect(() => {
    const p = listen<{ task_id: string; session_id: string; session_path: string }>('task-session', (e) => {
      if (e.payload.task_id !== taskId || !e.payload.session_path) return;
      setSessionPath(e.payload.session_path);
      setSessionId(e.payload.session_id);
      const resumeFlag = agent === 'codex' ? 'resume' : agent === 'claude' ? '--resume' : agent === 'pi' ? '--session' : null;
      const resumeCommand = resumeFlag ? `${agent} ${resumeFlag} ${e.payload.session_id}` : undefined;
      recordSession({
        agent,
        projectPath,
        sessionId: e.payload.session_id,
        sessionPath: e.payload.session_path,
        resumeCommand,
      });
      if (workspaceTaskId) {
        updateWorkspaceTask(workspaceTaskId, {
          sessionId: e.payload.session_id,
          sessionPath: e.payload.session_path,
          ...(agent === 'codex'
            ? { codexSessionId: e.payload.session_id, codexSessionPath: e.payload.session_path }
            : agent === 'claude'
              ? { claudeSessionId: e.payload.session_id, claudeSessionPath: e.payload.session_path }
              : {}),
        });
      }
    });
    return () => { void p.then((u) => u()); };
  }, [taskId, agent, projectPath, recordSession, updateWorkspaceTask, workspaceTaskId]);

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
    const listener = listen<{ task_id: string; status: string }>('task-status', (event) => {
      if (event.payload.task_id !== taskId) return;
      const nextStatus = event.payload.status;
      if (
        nextStatus !== 'running'
        && nextStatus !== 'input_required'
        && nextStatus !== 'awaiting_review'
        && nextStatus !== 'detached'
        && nextStatus !== 'interrupted'
        && nextStatus !== 'done'
        && nextStatus !== 'failed'
        && nextStatus !== 'cancelled'
      ) return;

      const currentStatus = statusRef.current;
      if (
        currentStatus !== 'idle'
        && shouldIgnoreAgentWorkspaceTaskStatusTransition(currentStatus, nextStatus)
      ) return;

      setStatus(nextStatus);
      setRunning(
        nextStatus === 'running'
        || nextStatus === 'input_required'
        || nextStatus === 'awaiting_review'
        || nextStatus === 'detached'
        || nextStatus === 'interrupted',
      );
      updateWorkspaceTaskState(nextStatus);

      if (nextStatus !== 'done' || !worktreePathRef.current) return;
      void invoke<{ additions: number; deletions: number }>('worktree_diff_stats', {
        ...worktreeDiffStatsArgs(projectPath, worktreePathRef.current, baseBranch),
      }).then((stats) => {
        setDiffStats(stats);
        if (workspaceTaskId) updateWorkspaceTask(workspaceTaskId, stats);
      }).catch(() => undefined);
    });
    return () => { void listener.then((unlisten) => unlisten()); };
  }, [baseBranch, projectPath, taskId, updateWorkspaceTask, updateWorkspaceTaskState, workspaceTaskId]);

  useEffect(() => {
    if (!sessionPath) {
      setMetrics(null);
      return;
    }
    let cancelled = false;
    const fetch = async () => {
      try {
        const next = await invoke<SessionMetrics>('read_session_metrics', { sessionPath });
        if (!cancelled) setMetrics(next);
      } catch { /* Session files may still be appearing while hooks settle. */ }
    };
    void fetch();
    if (running) metricsTimerRef.current = window.setInterval(fetch, 3_000);
    return () => {
      cancelled = true;
      if (metricsTimerRef.current) window.clearInterval(metricsTimerRef.current);
      metricsTimerRef.current = null;
    };
  }, [sessionPath, running]);

  const copySessionPath = useCallback(async () => {
    if (!sessionPath) return;
    try {
      await navigator.clipboard.writeText(sessionPath);
      setSessionPathCopied(true);
      window.setTimeout(() => setSessionPathCopied(false), 1600);
    } catch (reason) {
      setError(`复制会话路径失败：${String(reason)}`);
    }
  }, [sessionPath]);

  // ── Start / Cancel ───────────────────────────────────────────────────────
  const handleStart = useCallback(async (promptOverride?: string, forceResume = false) => {
    const basePrompt = (promptOverride ?? prompt).trim();
    if ((!basePrompt && attachedImages.length === 0 && textAttachments.length === 0 && !resumeIdRef.current) || (running && !forceResume)) return;
    const resumingExistingWorktree = Boolean(resumeIdRef.current && worktreePathRef.current);
    if (launchMode === 'worktree' && !resumingExistingWorktree && !baseBranch.trim()) {
      setError('请选择工作树的基础分支');
      return;
    }
    const taskPrompt = applyPlanModePrompt(basePrompt, planMode);
    setError(null); clearTerm(); setStatus('running'); setRunning(true); setMetrics(null); setDiffStats(null);
    if (workspaceTaskId) {
      updateWorkspaceTask(workspaceTaskId, {
        prompt: taskPrompt,
        title: taskPrompt.split('\n')[0].slice(0, 56),
        agent,
        permissionMode: perm,
        planMode,
        launchMode,
        baseBranch: baseBranch || undefined,
        isDraft: false,
      });
    }
    updateWorkspaceTaskState('running', { failureReason: undefined });
    onTaskStarted?.();

    const onOutput = new Channel<string>();
    outputChannelOwnedRef.current = true;
    onOutput.onmessage = (chunk) => writeTerm(chunk);

    try {
      let actualPath = projectPath || '.';
      if (launchMode === 'worktree') {
        if (resumeIdRef.current && worktreePathRef.current) {
          actualPath = worktreePathRef.current;
        } else {
          const result = await invoke<{ worktreePath: string; worktreeBranch: string; baseBranch: string }>(
            'create_task_worktree',
            createTaskWorktreeArgs(actualPath, taskId, baseBranch),
          );
          actualPath = result.worktreePath;
          setWorktreePath(result.worktreePath);
          worktreePathRef.current = result.worktreePath;
          setWorktreeBranch(result.worktreeBranch);
          setBaseBranch(result.baseBranch);
          setWorktreeDiscarded(false);
          if (workspaceTaskId) {
            updateWorkspaceTask(workspaceTaskId, {
              worktreePath: result.worktreePath,
              worktreeBranch: result.worktreeBranch,
              baseBranch: result.baseBranch,
              worktreeDiscarded: false,
            });
          }
        }
      }
      await invoke('run_task', {
        taskId,
        projectPath: actualPath,
        prompt: taskPrompt,
        agent,
        permissionMode: perm,
        images: attachedImages.map((image) => image.src),
        texts: textAttachments.map((attachment) => attachment.text),
        cols: 220,
        rows: 50,
        onOutput,
        resumeId: resumeIdRef.current,
      });
    } catch (e) {
      const failureReason = String(e);
      setError(failureReason);
      setStatus('failed');
      updateWorkspaceTaskState('failed', { failureReason });
      setRunning(false);
    }
  }, [prompt, running, agent, perm, projectPath, launchMode, baseBranch, taskId, writeTerm, clearTerm, updateWorkspaceTask, updateWorkspaceTaskState, workspaceTaskId, onTaskStarted, planMode, attachedImages, textAttachments]);

  const autoStartHandledRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartHandledRef.current || running || !prompt.trim()) return;
    autoStartHandledRef.current = true;
    void handleStart();
  }, [autoStart, handleStart, prompt, running]);

  const handleCancel = useCallback(async () => {
    try {
      await invoke('cancel_task', { taskId, projectPath: worktreePath || projectPath });
      setStatus('cancelled');
      updateWorkspaceTaskState('cancelled');
    } catch (e) {
      const failureReason = String(e);
      setError(failureReason);
      updateWorkspaceTaskState('failed', { failureReason });
    } finally { setRunning(false); }
  }, [projectPath, taskId, updateWorkspaceTaskState, worktreePath]);

  const handleMarkDone = useCallback(async () => {
    try {
      await invoke('complete_task', { taskId });
      setStatus('done');
      setRunning(false);
      updateWorkspaceTaskState('done');
    } catch (e) {
      setError(String(e));
    }
  }, [taskId, updateWorkspaceTaskState]);

  // ── Worktree actions ─────────────────────────────────────────────────────
  const mergeWorktree = async () => {
    if (!worktreePath || !worktreeBranch || worktreeBusy) return;
    setWorktreeBusy('merge');
    try {
      await invoke('merge_task_worktree', mergeTaskWorktreeArgs(projectPath, worktreePath, worktreeBranch, baseBranch));
      await invoke('remove_task_worktree', taskWorktreeArgs(projectPath, worktreePath, worktreeBranch)).catch(() => undefined);
      setDiffStats(null);
      setWorktreePath(null);
      worktreePathRef.current = null;
      setWorktreeBranch(null);
      setWorktreeDiscarded(true);
      if (workspaceTaskId) updateWorkspaceTask(workspaceTaskId, { worktreeDiscarded: true, additions: 0, deletions: 0 });
    } catch (e) { setError(String(e)); } finally { setWorktreeBusy(null); }
  };
  const discardWorktree = async () => {
    if (!worktreePath || !worktreeBranch || worktreeBusy) return;
    const accepted = await confirm(`确定丢弃工作树“${worktreeBranch}”及其中的所有修改吗？`, {
      title: '丢弃工作树',
      kind: 'warning',
    });
    if (!accepted) return;
    setWorktreeBusy('discard');
    try {
      await invoke('remove_task_worktree', taskWorktreeArgs(projectPath, worktreePath, worktreeBranch));
      setDiffStats(null);
      setWorktreePath(null);
      worktreePathRef.current = null;
      setWorktreeBranch(null);
      setWorktreeDiscarded(true);
      if (workspaceTaskId) updateWorkspaceTask(workspaceTaskId, { worktreeDiscarded: true, additions: 0, deletions: 0 });
    } catch (e) { setError(String(e)); } finally { setWorktreeBusy(null); }
  };

  const isDone = status === 'done' || status === 'failed' || status === 'cancelled';
  const needsRecovery = status === 'detached' || status === 'interrupted';
  const statusLabel = status === 'input_required'
    ? '需要输入'
    : status === 'awaiting_review'
      ? '等待审阅'
      : status === 'detached'
        ? '任务已分离'
        : status === 'interrupted'
          ? '任务已中断'
          : '智能体运行中';
  const currentHookReadiness = agent === 'claude' || agent === 'codex'
    ? hookReadiness?.find((entry) => entry.agent === agent) ?? null
    : null;
  const hookWarning = (() => {
    if (!currentHookReadiness || currentHookReadiness.usable) return null;
    const agentLabel = agent === 'claude' ? 'Claude Code' : 'Codex';
    if (currentHookReadiness.reason === 'version_too_low') {
      return `${agentLabel} ${currentHookReadiness.detected_version ?? ''} 低于钩子所需版本 ${currentHookReadiness.min_version ?? ''}。`;
    }
    if (currentHookReadiness.reason === 'no_node') return '未检测到 Node.js，实时任务钩子不可用。';
    return `${agentLabel} 的实时任务钩子尚未安装。`;
  })();

  // Match Nezha's NewTask draft behavior: configuration and prompt survive
  // project switches and application restarts, without persisting every key.
  useEffect(() => {
    if (!workspaceTaskId || running || isDone) return;
    const timer = window.setTimeout(() => {
      updateWorkspaceTask(workspaceTaskId, {
        prompt,
        agent,
        permissionMode: perm,
        planMode,
        launchMode,
        baseBranch: baseBranch || undefined,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [agent, baseBranch, isDone, launchMode, perm, planMode, prompt, running, updateWorkspaceTask, workspaceTaskId]);

  // A running task receives diff stats from the status event. A persisted task
  // does not replay that event after navigation, so restore the same data here.
  useEffect(() => {
    if (!isDone || !worktreePath) return;
    let cancelled = false;
    void invoke<{ additions: number; deletions: number }>('worktree_diff_stats', worktreeDiffStatsArgs(projectPath, worktreePath, baseBranch)).then((stats) => {
      if (!cancelled) setDiffStats(stats);
    }).catch(() => {
      if (!cancelled) setDiffStats(null);
    });
    return () => { cancelled = true; };
  }, [baseBranch, isDone, projectPath, worktreePath]);

  // Mark running tool events as done/error on task end (kooky PreToolUse/PostToolUse pattern)
  useEffect(() => {
    if (!isDone) return;
    setToolEvents((prev) =>
      prev.map((ev) => (ev.state === 'running' ? { ...ev, state: status === 'done' ? 'done' as const : 'error' as const, endedAt: Date.now() } : ev)),
    );
  }, [isDone, status]);

  // ── Resume support ──────────────────────────────────────────────────────
  const resumeFlag = agent === 'codex' ? 'resume' : agent === 'claude' ? '--resume' : agent === 'pi' ? '--session' : null;
  const resumeIdRef = useRef<string | null>(null);
  const recoverySessionId = sessionId ?? sessionPath?.split(/[\\/]/).pop()?.replace(/\.jsonl$/, '') ?? '';
  const canResume = !running && isDone && !!recoverySessionId && !!resumeFlag && !worktreeDiscarded;

  const handleResume = useCallback(() => {
    if (worktreeDiscarded) return;
    const resumeSessionId = recoverySessionId;
    if (!resumeSessionId) return;
    resumeIdRef.current = resumeSessionId;
    setError(null);
    setMetrics(null);
    setDiffStats(null);
    void handleStart(prompt, true);
  }, [handleStart, prompt, recoverySessionId, worktreeDiscarded]);

  const handleReconnect = useCallback(async () => {
    if (!recoverySessionId) return;
    setError(null);
    try {
      await invoke('reset_task_process', { taskId });
      handleResume();
    } catch (reason) {
      setError(`重置任务进程失败：${String(reason)}`);
    }
  }, [handleResume, recoverySessionId, taskId]);

  const handleExportSession = useCallback(async () => {
    if (!sessionPath || exportingSession) return;
    setExportingSession(true);
    try {
      const title = (prompt.split('\n')[0].trim() || 'session').slice(0, 50);
      const safeName = title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
      const outputPath = await save({
        title: '导出会话 Markdown',
        defaultPath: `junqi-${safeName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!outputPath) return;
      await invoke('export_session_markdown', {
        sessionPath,
        outputPath,
        taskMeta: {
          name: title,
          prompt,
          agent,
          created_at: Math.floor(Date.now() / 1000),
          session_id: sessionPath.split(/[\\/]/).pop()?.replace(/\.jsonl$/, '') ?? null,
        },
      });
    } catch (reason) {
      setError(`导出会话失败：${String(reason)}`);
    } finally {
      setExportingSession(false);
    }
  }, [agent, exportingSession, prompt, sessionPath]);

  useEffect(() => { if (prompt === '' && resumeIdRef.current) resumeIdRef.current = null; }, [prompt]);

  const commitTitle = useCallback(() => {
    const nextTitle = titleDraft.trim();
    if (nextTitle) {
      setTaskTitle(nextTitle);
      if (workspaceTaskId) updateWorkspaceTask(workspaceTaskId, { title: nextTitle });
    }
    setEditingTitle(false);
  }, [titleDraft, updateWorkspaceTask, workspaceTaskId]);

  const generateTitle = useCallback(async () => {
    if (!workspaceTaskId || generatingTitle || running) return;
    const expectedTask = useAgentWorkspaceStore.getState().tasks.find((task) => task.id === workspaceTaskId);
    if (!expectedTask) return;
    const snapshot = captureTaskNameSnapshot(expectedTask);
    setGeneratingTitle(true);
    try {
      const nextTitle = await invoke<string>('generate_task_name', {
        projectPath,
        agent,
        originalPrompt: prompt,
      });
      const title = nextTitle.trim();
      if (!title) return;
      const currentTask = useAgentWorkspaceStore.getState().tasks.find((task) => task.id === workspaceTaskId);
      if (!taskStillMatchesNameSnapshot(currentTask, snapshot)) return;
      setTaskTitle(title);
      setTitleDraft(title);
      updateWorkspaceTask(workspaceTaskId, { title });
    } catch (reason) {
      setError(`生成任务名称失败：${String(reason)}`);
    } finally {
      setGeneratingTitle(false);
    }
  }, [agent, generatingTitle, projectPath, prompt, running, updateWorkspaceTask, workspaceTaskId]);

  // ── Save as Todo ────────────────────────────────────────────────────────
  const handleSaveTodo = useCallback(() => {
    if (launchMode === 'worktree' || (!prompt.trim() && textAttachments.length === 0)) return;
    if (workspaceTaskId) {
      updateWorkspaceTask(workspaceTaskId, {
        prompt,
        title: prompt.split('\n')[0].slice(0, 56),
        agent,
        permissionMode: perm,
        planMode,
        launchMode,
        baseBranch: baseBranch || undefined,
        status: 'todo',
        isDraft: false,
      });
    }
    onTaskSaved?.();
    setAttachedImages([]); setTextAttachments([]);
  }, [prompt, agent, perm, textAttachments, workspaceTaskId, updateWorkspaceTask, onTaskSaved, launchMode]);

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
      {(running || isDone) && (
        <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ background: 'rgb(var(--aegis-primary)/0.06)', borderColor: 'rgb(var(--aegis-border))' }}>
          <StatusBadge state={needsRecovery ? 'idle' : status === 'done' ? 'ended' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'idle' : 'running'} size={10} />
          <StatusIcon status={status} size={13} />
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTitle();
                if (event.key === 'Escape') setEditingTitle(false);
              }}
              className="h-7 min-w-0 max-w-[420px] flex-1 border-b-2 border-aegis-primary bg-transparent px-1 text-sm font-semibold outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-aegis-text">{taskTitle || prompt || statusLabel}</span>
          )}
          {!editingTitle && (
            <button type="button" onClick={() => { setTitleDraft(taskTitle); setEditingTitle(true); }} title="重命名任务" className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">
              <Pencil size={13} />
            </button>
          )}
          {!running && (
            <button type="button" disabled={generatingTitle} onClick={() => void generateTitle()} title="生成任务名称" className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50">
              <Sparkle size={13} className={generatingTitle ? 'animate-spin' : ''} />
            </button>
          )}
          {running && worktreePath && onOpenWorktreeTerminal && (
            <button type="button" onClick={onOpenWorktreeTerminal} title="打开工作树终端" className="inline-flex h-7 items-center gap-1.5 rounded border border-aegis-border px-2 text-[11px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">
              <SquareTerminal size={12} />工作树终端
            </button>
          )}
          {running && <>
            <button type="button" onClick={handleMarkDone} title="标记完成" className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-emerald-500/10 hover:text-emerald-400"><CheckCircle2 size={13} /></button>
            <button type="button" onClick={handleCancel} title="取消任务" className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-red-500/10 hover:text-red-400"><Square size={12} fill="currentColor" /></button>
          </>}
        </div>
      )}

      {/* ── Missing-file warning ──────────────────────────────────────── */}
      {missingInstructionsFile && !running && !isDone && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg flex items-center gap-2 text-[12px]"
          style={{ background: 'rgb(var(--aegis-warning)/0.06)', border: '1px solid rgb(var(--aegis-warning)/0.2)', color: 'rgb(var(--aegis-warning))' }}>
          <FileWarning size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">{agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'} 未找到，创建后可让智能体理解项目约束。</span>
          <button
            type="button"
            title={`初始化 ${agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}`}
            onClick={() => void handleStart(`Create a concise ${agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'} for this project. Inspect the repository first, then document its architecture, development commands, test commands, and coding conventions.`)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-aegis-warning hover:bg-aegis-warning/10"
          >
            <FilePlus2 size={14} />
          </button>
        </div>
      )}

      {hookWarning && !running && !isDone && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2 text-[12px] text-aegis-text-dim">
          <AlertCircle size={14} className="shrink-0 text-amber-400" />
          <span>{hookWarning}</span>
        </div>
      )}

      {/* ── Scrollable body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!running && !isDone && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
            {providedProjectPath === undefined && (
              <input value={projectPath} onChange={(event) => setProjectPath(event.target.value)}
                placeholder="项目路径（留空使用当前目录）"
                className="h-9 w-full rounded-md border border-aegis-border bg-aegis-bg px-3 font-mono text-xs text-aegis-text outline-none focus:border-aegis-primary" />
            )}

            <div className="overflow-visible rounded-lg border border-aegis-border bg-aegis-card shadow-sm">
              <div className="p-3 pb-1">
                <PromptEditor
                  value={prompt} onChange={(next) => {
                    draftUserEditedRef.current = true;
                    setPrompt(next);
                  }} onSubmit={handleStart} submitHint=""
                  placeholder="描述你的任务... 输入 @ 引用文件"
                  rows={4} disabled={running} draftKey={`agent-run:${taskId}`}
                  projectPath={projectPath}
                  mentionProjects={mentionProjects}
                  expanded={composerExpanded} onExpandedChange={setComposerExpanded}
                  images={attachedImages} onAttachImages={setAttachedImages}
                  onRemoveImage={(i) => setAttachedImages((previous) => previous.filter((_, index) => index !== i))}
                  onLargePaste={(text) => setTextAttachments((previous) => [...previous, { text, chars: text.length }])} />
              </div>

              {textAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                  {textAttachments.map((attachment, index) => (
                    <div key={index} className="flex items-center gap-1.5 rounded border border-aegis-border bg-aegis-surface px-2.5 py-1 text-[11px] text-aegis-text-dim">
                      <FileText size={11} />
                      <span>文本附件 · {attachment.chars > 1000 ? `${(attachment.chars / 1000).toFixed(1)}K` : attachment.chars} 字符</span>
                      <button type="button" title="移除附件" onClick={() => setTextAttachments((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="ml-1 rounded p-0.5 hover:bg-red-500/10 hover:text-red-400">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-aegis-border px-3 py-2">
                <AgentToggle agent={agent} allowPi={providedProjectPath === undefined} onChange={(next) => {
                  draftUserEditedRef.current = true;
                  setAgent(next);
                }} disabled={running} />
                <PermissionSelector perm={perm} onChange={(next) => {
                  draftUserEditedRef.current = true;
                  setPerm(next);
                }} disabled={running} />
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-aegis-text-dim">
                  <input type="checkbox" checked={planMode} onChange={(event) => {
                    draftUserEditedRef.current = true;
                    setPlanMode(event.target.checked);
                  }} className="h-3.5 w-3.5 accent-aegis-primary" />
                  计划模式
                </label>
                <div className="min-w-2 flex-1" />
                {attachedImages.length > 0 && (
                  <button type="button" title="清空图片" onClick={() => setAttachedImages([])} className="flex h-8 items-center gap-1 rounded px-2 text-[11px] text-aegis-text-dim hover:bg-aegis-hover hover:text-red-400">
                    <X size={12} />{attachedImages.length}
                  </button>
                )}
                <button type="button" onClick={handleSaveTodo}
                  disabled={launchMode === 'worktree' || (!prompt.trim() && textAttachments.length === 0)}
                  title={launchMode === 'worktree' ? '工作树任务需要直接启动' : '保存为待办'}
                  className="flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40">
                  <Bookmark size={13} />保存为待办
                </button>
                <button type="button" title="发送任务" onClick={() => void handleStart()}
                  disabled={!prompt.trim() && textAttachments.length === 0 && attachedImages.length === 0}
                  className="flex h-8 w-8 items-center justify-center rounded bg-aegis-primary text-white disabled:cursor-not-allowed disabled:opacity-40">
                  <Play size={14} fill="currentColor" />
                </button>
              </div>
            </div>

            <div className="flex min-h-10 items-center rounded-md border border-aegis-border bg-aegis-surface px-3">
              <LaunchSelector mode={launchMode} baseBranch={baseBranch}
                onMode={(next) => {
                  draftUserEditedRef.current = true;
                  setLaunchMode(next);
                }} onBranch={(next) => {
                  draftUserEditedRef.current = true;
                  setBaseBranch(next);
                }} disabled={running} projectPath={projectPath} />
            </div>
          </div>
        )}

        {/* ── Running: minimal terminal + plan-A input dock ───────────── */}
        {running && (
          <div className="flex-1 flex flex-col min-h-0 px-4 pb-2 gap-1">
            {needsRecovery ? (
              <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-3 rounded border border-amber-400/25 bg-amber-400/5 p-6 text-center">
                <AlertCircle size={26} className="text-amber-400" />
                <div>
                  <div className="text-sm font-semibold text-aegis-text">{status === 'detached' ? '运行连接已分离' : '运行被中断'}</div>
                  <p className="mt-1 text-xs leading-5 text-aegis-text-dim">会话记录会保留。恢复后可以继续编辑提示词并重新运行。</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!recoverySessionId}
                    title={!recoverySessionId ? '未保存会话 ID，无法恢复' : undefined}
                    onClick={() => {
                      if (status === 'detached') void handleReconnect();
                      else handleResume();
                    }}
                    className="inline-flex items-center gap-1.5 rounded bg-aegis-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <RotateCcw size={12} />{status === 'detached' ? '重新连接' : '继续会话'}
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkDone}
                    className="inline-flex items-center gap-1.5 rounded border border-aegis-border px-3 py-1.5 text-xs text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                  >
                    <CheckCircle2 size={12} />标记完成
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex items-center gap-1.5 rounded border border-aegis-border px-3 py-1.5 text-xs text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                  >
                    <X size={12} />结束任务
                  </button>
                </div>
              </div>
            ) : terminalError ? (
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
            {sessionPath ? (
              <div className="min-h-[200px] flex-1 overflow-hidden border border-aegis-border">
                <SessionViewPage
                  sessionPath={sessionPath}
                  embedded
                  onRun={canResume ? handleResume : undefined}
                />
              </div>
            ) : (
              <div key="done" ref={termRef} className="flex-1 overflow-hidden"
                style={{ background: "var(--terminal-bg)", border: "1px solid var(--terminal-border)", minHeight: 200 }} />
            )}
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
                {worktreePath && diffStats && (
                  <>
                    <span className="text-[rgb(var(--aegis-success))]">+{diffStats.additions}</span>
                    <span className="text-[rgb(var(--aegis-danger))]">−{diffStats.deletions}</span>
                    <button type="button" disabled={worktreeBusy !== null} onClick={() => void mergeWorktree()}
                      className="hover:text-[rgb(var(--aegis-success))] transition-colors disabled:cursor-wait disabled:opacity-50">
                      {worktreeBusy === 'merge' ? '合并中...' : t('agent.worktree.merge', 'merge')}
                    </button>
                    <button type="button" disabled={worktreeBusy !== null} onClick={() => void discardWorktree()}
                      className="hover:text-[rgb(var(--aegis-danger))] transition-colors disabled:cursor-wait disabled:opacity-50">
                      {worktreeBusy === 'discard' ? '丢弃中...' : t('agent.worktree.discard', 'discard')}
                    </button>
                    <span className="text-[rgb(var(--aegis-text-dim))]">·</span>
                  </>
                )}
                {(sessionPath || canResume) && (
                  <>
                    {sessionPath && <>
                      <button type="button" onClick={() => void copySessionPath()} title={sessionPath}
                        className="inline-flex items-center gap-1 hover:text-[rgb(var(--aegis-primary))] transition-colors">
                        {sessionPathCopied ? <Check size={10} /> : <Copy size={10} />}
                        {sessionPathCopied ? '已复制路径' : '会话文件'}
                      </button>
                      <button onClick={() => navigate(`/session?path=${encodeURIComponent(sessionPath)}`)} title={sessionPath}
                        className="hover:text-[rgb(var(--aegis-primary))] transition-colors">{t('agent.session.view', 'session')}</button>
                      <button
                        type="button"
                        disabled={exportingSession}
                        onClick={() => void handleExportSession()}
                        title="导出会话 Markdown"
                        className="flex h-5 w-5 items-center justify-center rounded hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
                      >
                        <Download size={11} />
                      </button>
                    </>}
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
