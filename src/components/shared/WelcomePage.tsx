// ═══════════════════════════════════════════════════════════
// WelcomePage — adapted from nezha (hanshuaikang/nezha/WelcomePage)
//
// Three-view landing page with sidebar nav:
//   - Projects   : list of CLI tools / agents detected on the system
//   - Timeline   : recent task activity (wraps TimelineView)
//   - Skill Hub  : skill marketplace view (links to /skill-hub)
//
// This is a minimal port: no full multi-project state machine (junqi has no
// "open a project" concept), no pin/unpin of projects, no per-project search.
// The three-view structure + sidebar nav pattern is preserved.
//
// Source: nezha/src/components/nezha/WelcomePage.tsx (395 lines)
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, FolderOpen, Plus, Trash2, Clock, Blocks,
  Inbox, Layers, FolderSearch, Loader2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TimelineView, type TimelineTask } from './TimelineView';
import { useChatStore } from '@/stores/chatStore';
import { useWorkshopStore } from '@/stores/workshopStore';

interface CLITool {
  id: string;
  label: string;
  icon: string;
  cmd: string;
}

type View = 'projects' | 'timeline' | 'skills';

function deriveTimelineTasks(): TimelineTask[] {
  const chat = useChatStore.getState();
  const workshop = useWorkshopStore.getState();
  const out: TimelineTask[] = [];

  for (const task of workshop.tasks) {
    const created = Date.parse(task.createdAt);
    if (Number.isNaN(created)) continue;
    out.push({
      id: `workshop:${task.id}`,
      title: task.title,
      agent: task.assignedAgent,
      status: task.status,
      createdAt: created,
      project: 'Workshop',
    });
  }

  const sessions = chat.sessions ?? [];
  for (let i = sessions.length - 1; i >= 0; i--) {
    const sessionKey = sessions[i].key;
    const msgs = chat.messagesPerSession?.[sessionKey] ?? [];
    for (const msg of msgs) {
      if (msg.role !== 'user') continue;
      const ts = msg.timestamp ? Date.parse(msg.timestamp) : 0;
      if (!ts) continue;
      const text = typeof msg.content === 'string' ? msg.content : '';
      const title = text.trim().split('\n')[0]?.slice(0, 80) || '(empty)';
      out.push({
        id: `chat:${msg.id}`,
        title,
        agent: sessions[i].label,
        status: 'queued',
        createdAt: ts,
        project: sessions[i].label,
      });
    }
  }

  return out;
}

interface WelcomePageProps {
  /** Called when user picks a project (CLI tool) to launch. */
  onLaunchTool?: (tool: CLITool) => void;
}

export function WelcomePage({ onLaunchTool }: WelcomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('projects');
  const [query, setQuery] = useState('');
  const [tools, setTools] = useState<CLITool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('junqi:recent-projects') || '[]'); } catch { return []; }
  });
  const [savedTodos, setSavedTodos] = useState<{ at: number; agent: string; prompt: string; perm: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('junqi:saved-todos') || '[]'); } catch { return []; }
  });
  const refreshTodos = useCallback(() => {
    try { setSavedTodos(JSON.parse(localStorage.getItem('junqi:saved-todos') || '[]')); } catch { setSavedTodos([]); }
  }, []);

  // Auto-detect CLI tools via the existing `detect_cli_tools` command.
  // Backend runs `which` for 29 candidates sequentially — add a 5s frontend
  // timeout so the UI never gets stuck on "Detecting…" permanently.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const detect = () => {
      invoke<CLITool[]>('detect_cli_tools')
        .then((detected) => {
          if (!cancelled && detected && detected.length > 0) {
            setTools(detected);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('[WelcomePage] detect_cli_tools failed', err);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setToolsLoading(false);
            if (timer) clearTimeout(timer);
          }
        });
      // Safety net: if the backend hangs, show empty state after 5s
      timer = setTimeout(() => {
        if (!cancelled) setToolsLoading(false);
      }, 5000);
    };
    detect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const tasks = useMemo(() => deriveTimelineTasks(), []);
  const filteredTools = useMemo(() => {
    if (!query.trim()) return tools;
    const q = query.toLowerCase();
    return tools.filter(
      (tool) =>
        tool.label.toLowerCase().includes(q) ||
        tool.cmd.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q),
    );
  }, [tools, query]);

  const sidebarItems: Array<{ key: View; icon: React.ReactNode; label: string }> = [
    { key: 'projects', icon: <Layers size={14} />, label: t('welcome.projects', 'Projects') },
    { key: 'timeline', icon: <Clock size={14} />, label: t('welcome.timeline', 'Timeline') },
    { key: 'skills', icon: <Blocks size={14} />, label: t('welcome.skills', 'Skill Hub') },
  ];

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'rgb(var(--aegis-bg))' }}>
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className="w-[180px] flex flex-col border-r"
        style={{
          background: 'rgb(var(--aegis-surface))',
          borderColor: 'rgb(var(--aegis-border))',
        }}
      >
        <div className="px-3 py-4 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
              style={{
                background: 'rgb(var(--aegis-primary))',
                color: 'rgb(var(--aegis-on-primary))',
              }}
            >
              JQ
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold text-aegis-text">JunQi</div>
              <div className="text-[10px] text-aegis-text-dim">Desktop workspace</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          {sidebarItems.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-start text-[12px] font-medium transition-colors"
                style={{
                  background: active ? 'rgb(var(--aegis-overlay) / 0.1)' : 'transparent',
                  color: active ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-muted))',
                  fontWeight: active ? 600 : 500,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'rgb(var(--aegis-overlay) / 0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
          <div className="text-[10px] text-aegis-text-dim leading-relaxed">
            JunQi is an OpenClaw Gateway desktop client with Nezha-style AI tooling.
          </div>
        </div>
      </aside>

      {/* ── Main panel ──────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        {view === 'projects' && (
          <ProjectsView
            tools={tools}
            filteredTools={filteredTools}
            loading={toolsLoading}
            query={query}
            onQueryChange={setQuery}
            navigate={navigate}
            recentProjects={recentProjects}
            savedTodos={savedTodos}
            onDeleteTodo={(i) => {
              const updated = savedTodos.filter((_, idx) => idx !== i);
              localStorage.setItem('junqi:saved-todos', JSON.stringify(updated));
              refreshTodos();
            }}
            onOpenTodo={(todo) => {
              navigate(`/agent-run?agent=${todo.agent}&prompt=${encodeURIComponent(todo.prompt)}`);
            }}
            onOpenProject={(path) => {
              const updated = [path, ...recentProjects.filter((p) => p !== path)].slice(0, 10);
              setRecentProjects(updated);
              localStorage.setItem('junqi:recent-projects', JSON.stringify(updated));
              navigate(`/files?path=${encodeURIComponent(path)}`);
            }}
            onLaunch={(tool) => {
              if (onLaunchTool) {
                onLaunchTool(tool);
              } else {
                navigate('/terminal');
              }
            }}
          />
        )}
        {view === 'timeline' && (
          <TimelineView
            tasks={tasks}
            title={t('timeline.title', 'Timeline')}
            subtitle={t('welcome.timelineSubtitle', 'Recent activity across chat sessions and the workshop kanban.')}
            emptyMessage={t('timeline.empty', 'No tasks in the past 7 days.')}
          />
        )}
        {view === 'skills' && <SkillsView />}
      </main>
    </div>
  );
}

function ProjectsView({
  tools, filteredTools, loading, query, onQueryChange, onLaunch, navigate,
  recentProjects, onOpenProject, savedTodos, onDeleteTodo, onOpenTodo,
}: {
  tools: CLITool[];
  filteredTools: CLITool[];
  loading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onLaunch: (tool: CLITool) => void;
  navigate: (path: string) => void;
  recentProjects: string[];
  onOpenProject: (path: string) => void;
  savedTodos: { at: number; agent: string; prompt: string; perm: string }[];
  onDeleteTodo: (index: number) => void;
  onOpenTodo: (todo: { agent: string; prompt: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md flex-1"
            style={{
              background: 'rgb(var(--aegis-input))',
              border: '1px solid rgb(var(--aegis-border))',
            }}
          >
            <Search size={14} className="text-aegis-text-dim shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={t('welcome.searchTools', 'Search CLI tools…')}
              className="flex-1 bg-transparent text-[13px] text-aegis-text placeholder:text-aegis-text-dim outline-none"
            />
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                const selected = await openDialog({ directory: true, multiple: false, title: 'Open project folder' });
                if (selected && !Array.isArray(selected)) onOpenProject(selected);
              } catch { /* user cancelled */ }
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-medium transition-colors shrink-0"
            style={{
              background: 'rgb(var(--aegis-overlay) / 0.05)',
              border: '1px solid rgb(var(--aegis-border))',
              color: 'rgb(var(--aegis-text-secondary))',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--aegis-overlay) / 0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--aegis-overlay) / 0.05)'; }}
          >
            <FolderSearch size={14} />
            Browse
          </button>
        </div>
        <div className="mt-3 text-[10.5px] text-aegis-text-dim uppercase tracking-wider">
          {loading
            ? t('welcome.detecting', 'Detecting…')
            : `${tools.length} ${t('welcome.toolsDetected', 'tools detected')}`}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Saved todos */}
        {!loading && savedTodos.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold mb-2">
              Saved prompts ({savedTodos.length})
            </div>
            <div className="flex flex-col gap-1">
              {savedTodos.slice().reverse().map((todo, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: 'rgb(var(--aegis-card))', border: '1px solid rgb(var(--aegis-border))' }}>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono text-aegis-text-dim"
                    style={{ background: 'rgb(var(--aegis-overlay)/0.04)' }}>{todo.agent}</span>
                  <span className="flex-1 text-[12px] text-aegis-text truncate">{todo.prompt.slice(0, 60)}{todo.prompt.length > 60 ? '…' : ''}</span>
                  <button type="button" onClick={() => onOpenTodo(todo)}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20">
                    Open
                  </button>
                  <button type="button" onClick={() => onDeleteTodo(savedTodos.length - 1 - i)}
                    className="p-1 rounded hover:bg-[rgb(var(--aegis-danger)/0.08)] text-aegis-text-dim hover:text-aegis-danger">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold">
              Recent projects
            </div>
          </div>
        )}
        {/* Recent projects */}
        {!loading && recentProjects.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold mb-2">
              Recent projects
            </div>
            <div className="flex flex-col gap-1">
              {recentProjects.map((p) => (
                <button key={p} type="button" onClick={() => onOpenProject(p)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.04)]">
                  <span className="p-1 rounded-md" style={{ background: 'rgb(var(--aegis-primary)/0.08)' }}><FolderOpen size={13} className="text-aegis-primary" /></span>
                  <span className="text-[12px] font-mono text-aegis-text truncate">{p}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider text-aegis-text-dim font-semibold">
              CLI tools
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-[13px] text-aegis-text-dim">
              <Clock size={14} className="animate-pulse" />
              {t('welcome.detecting', 'Detecting…')}
            </div>
          </div>
        ) : tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-8 text-center gap-4">
            <Inbox size={36} className="text-aegis-text-dim opacity-30" />
            <div>
              <div className="text-[14px] font-semibold text-aegis-text">
                {t('welcome.noTools', 'No AI tools detected')}
              </div>
              <div className="text-[12px] text-aegis-text-dim mt-1">
                Install one of these agents to get started:
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[320px] text-left">
              {[
                { name: 'Claude Code', cmd: 'npm install -g @anthropic-ai/claude-code', icon: '🤖' },
                { name: 'Codex', cmd: 'npm install -g @openai/codex', icon: '🧠' },
                { name: 'Gemini CLI', cmd: 'npm install -g @google/gemini-cli', icon: '🌟' },
                { name: 'Aider', cmd: 'pip install aider-chat', icon: '🔧' },
              ].map((agent) => (
                <div key={agent.name} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: 'rgb(var(--aegis-overlay) / 0.03)', border: '1px solid rgb(var(--aegis-border))' }}>
                  <span className="text-base shrink-0">{agent.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-aegis-text">{agent.name}</div>
                    <code className="text-[10px] text-aegis-text-dim font-mono select-all">{agent.cmd}</code>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-aegis-text-dim">
              After installing, restart JunQi to detect them automatically.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredTools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onLaunch(tool)}
                className="flex items-start gap-3 px-3 py-3 rounded-lg text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                style={{
                  background: 'rgb(var(--aegis-card))',
                  border: '1px solid rgb(var(--aegis-border))',
                }}
              >
                <div
                  className="w-9 h-9 rounded-md flex items-center justify-center text-[16px] shrink-0"
                  style={{
                    background: 'rgb(var(--aegis-overlay) / 0.06)',
                    border: '1px solid rgb(var(--aegis-border))',
                  }}
                >
                  {tool.icon || <FolderOpen size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-aegis-text truncate">{tool.label}</div>
                  <div className="text-[10.5px] text-aegis-text-dim font-mono truncate mt-0.5">{tool.cmd}</div>
                </div>
                <Plus size={14} className="text-aegis-text-dim shrink-0 mt-1" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<{ name: string; displayName?: string; description?: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<{ name: string; displayName?: string; description?: string }[]>('list_skills')
      .then((list) => { if (!cancelled) setSkills(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        <div>
          <div className="text-[16px] font-bold text-aegis-text">Skill Hub</div>
          <div className="text-[12px] text-aegis-text-dim mt-1">
            {loading ? 'Loading…' : `${skills.length} skills found`}
          </div>
        </div>
        <button type="button" onClick={() => navigate('/skill-hub')}
          className="px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors"
          style={{ background: 'rgb(var(--aegis-overlay)/0.05)', color: 'rgb(var(--aegis-text-secondary))', border: '1px solid rgb(var(--aegis-border))' }}>
          Manage →
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={16} className="animate-spin text-aegis-text-dim" /></div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Blocks size={32} className="text-aegis-text-dim opacity-30" />
            <div className="text-[13px] text-aegis-text-dim">No skills found.</div>
            <div className="text-[11px] text-aegis-text-dim">Set a hub path in Skill Hub Manager to get started.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {skills.map((s) => (
              <div key={s.name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{ background: 'rgb(var(--aegis-card))', border: '1px solid rgb(var(--aegis-border))' }}>
                <span className="w-7 h-7 rounded-md flex items-center justify-center text-[14px]"
                  style={{ background: 'rgb(var(--aegis-overlay)/0.06)' }}>📦</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-aegis-text">{s.displayName ?? s.name}</div>
                  {s.description && <div className="text-[10px] text-aegis-text-dim truncate">{s.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default WelcomePage;