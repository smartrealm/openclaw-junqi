import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Blocks,
  Box,
  ChevronDown,
  Clock,
  Codepen,
  Container,
  Cpu,
  FolderOpen,
  GitBranch,
  Hammer,
  Inbox,
  Layers,
  Loader2,
  LayoutDashboard,
  Monitor,
  Package,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Cube, Robot } from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TimelineView, type TimelineTask } from './TimelineView';
import { Icon } from '@/components/shared/icons';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { useChatStore } from '@/stores/chatStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { debugWarn } from '@/utils/debugLog';
import { migrateLegacyProjectPaths } from '@/workspace/projectWorkspace';

export interface CLITool {
  id: string;
  label: string;
  icon: React.ReactNode;
  cmd: string;
}

export interface WorkspaceProject {
  path: string;
  name: string;
}

interface ProjectWithBranch extends WorkspaceProject {
  /** Undefined while Git metadata is loading; null means a local non-Git directory. */
  branch?: string | null;
}

interface GitBranchInfo {
  name: string;
  current: boolean;
}

interface SavedTodo {
  at: number;
  agent: string;
  prompt: string;
  perm: string;
}

type View = 'projects' | 'timeline' | 'skills';

function toolIcon(id: string): React.ReactNode {
  const agent = Icon.agent[id];
  if (agent) return agent.icon;

  const icons: Record<string, React.ReactNode> = {
    cody: <Robot size={14} weight="regular" />,
    continue: <RefreshCw size={14} strokeWidth={1.75} />,
    'shell-gpt': <Terminal size={14} strokeWidth={1.75} />,
    gptme: <Terminal size={14} strokeWidth={1.75} />,
    devbox: <Container size={14} strokeWidth={1.75} />,
    gh: <GitBranch size={14} strokeWidth={1.75} />,
    docker: <Container size={14} strokeWidth={1.75} />,
    kubectl: <Server size={14} strokeWidth={1.75} />,
    helm: <Server size={14} strokeWidth={1.75} />,
    terraform: <Codepen size={14} strokeWidth={1.75} />,
    python3: <Terminal size={14} strokeWidth={1.75} />,
    node: <Cpu size={14} strokeWidth={1.75} />,
    cargo: <Package size={14} strokeWidth={1.75} />,
    pnpm: <Package size={14} strokeWidth={1.75} />,
    yarn: <Package size={14} strokeWidth={1.75} />,
    brew: <Package size={14} strokeWidth={1.75} />,
    nvim: <Terminal size={14} strokeWidth={1.75} />,
    vim: <Terminal size={14} strokeWidth={1.75} />,
    code: <Monitor size={14} strokeWidth={1.75} />,
    make: <Hammer size={14} strokeWidth={1.75} />,
    just: <Settings2 size={14} strokeWidth={1.75} />,
  };
  return icons[id] ?? <Box size={14} strokeWidth={1.75} />;
}

function readSavedTodos(): SavedTodo[] {
  try {
    const value = JSON.parse(localStorage.getItem('junqi:saved-todos') || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const PROJECT_AVATAR_CLASSES = [
  'bg-cyan-700',
  'bg-blue-700',
  'bg-emerald-700',
  'bg-violet-700',
  'bg-sky-700',
  'bg-rose-700',
] as const;

function projectInitials(name: string): string {
  const normalized = name.trim();
  if (!normalized) return '?';

  const segments = normalized.split(/[\s._-]+/).filter(Boolean);
  if (segments.length > 1) {
    const first = Array.from(segments[0])[0] ?? '';
    const last = Array.from(segments[segments.length - 1])[0] ?? '';
    return `${first}${last}`.toLocaleUpperCase();
  }
  return Array.from(normalized).slice(0, 2).join('').toLocaleUpperCase();
}

function projectAvatarClass(name: string): string {
  let hash = 0;
  for (const character of name) hash = ((hash * 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  return PROJECT_AVATAR_CLASSES[hash % PROJECT_AVATAR_CLASSES.length];
}

async function migrateLegacyProjects(): Promise<void> {
  let paths: string[] = [];
  try {
    const value = JSON.parse(localStorage.getItem('junqi:recent-projects') || '[]');
    if (Array.isArray(value)) {
      paths = value.filter((path): path is string => typeof path === 'string' && path.length > 0);
    }
  } catch {
    localStorage.removeItem('junqi:recent-projects');
    return;
  }
  if (paths.length === 0) return;

  const retryPaths = await migrateLegacyProjectPaths(
    paths,
    async (path) => {
      await invoke('record_terminal_workspace_directory', { path });
    },
  );
  try {
    if (retryPaths.length > 0) {
      localStorage.setItem('junqi:recent-projects', JSON.stringify(retryPaths));
    } else {
      localStorage.removeItem('junqi:recent-projects');
    }
  } catch (error) {
    debugWarn('app', '[WelcomePage] legacy project migration state update failed', error);
  }
}

interface WelcomePageProps {
  onLaunchTool?: (tool: CLITool) => void;
  onOpenProject?: (project: WorkspaceProject) => Promise<void> | void;
}

export function WelcomePage({ onLaunchTool, onOpenProject }: WelcomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('projects');
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ProjectWithBranch[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tools, setTools] = useState<CLITool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [savedTodos, setSavedTodos] = useState<SavedTodo[]>(readSavedTodos);
  const projectLoadId = useRef(0);

  const workshopTasks = useWorkshopStore((state) => state.tasks);
  const sessions = useChatStore((state) => state.sessions ?? []);
  const messagesPerSession = useChatStore((state) => state.messagesPerSession ?? {});

  const refreshProjects = useCallback(async () => {
    const loadId = ++projectLoadId.current;
    setProjectsLoading(true);
    setProjectsError(false);
    try {
      await migrateLegacyProjects();
      const directories = await invoke<WorkspaceProject[]>('list_terminal_recent_workspaces');
      if (projectLoadId.current !== loadId) return;

      const initial = directories.map((directory) => ({ ...directory, branch: undefined }));
      setProjects(initial);
      setProjectsLoading(false);

      const enriched = await Promise.all(directories.map(async (directory) => {
        try {
          const branches = await invoke<GitBranchInfo[]>('git_list_branches', {
            projectPath: directory.path,
          });
          return { ...directory, branch: branches.find((branch) => branch.current)?.name ?? null };
        } catch {
          return { ...directory, branch: null };
        }
      }));
      if (projectLoadId.current === loadId) {
        const branchesByPath = new Map(enriched.map((project) => [project.path, project.branch]));
        setProjects((current) => current.map((project) => ({
          ...project,
          branch: branchesByPath.has(project.path)
            ? branchesByPath.get(project.path)
            : project.branch,
        })));
      }
    } catch (error) {
      if (projectLoadId.current !== loadId) return;
      debugWarn('app', '[WelcomePage] recent workspace load failed', error);
      setProjects([]);
      setProjectsLoading(false);
      setProjectsError(true);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    return () => {
      projectLoadId.current += 1;
    };
  }, [refreshProjects]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) setToolsLoading(false);
    }, 5000);

    invoke<CLITool[]>('detect_cli_tools')
      .then((detected) => {
        if (cancelled) return;
        setTools((detected ?? []).map((tool) => ({ ...tool, icon: toolIcon(tool.id) })));
      })
      .catch((error) => {
        if (!cancelled) debugWarn('app', '[WelcomePage] detect_cli_tools failed', error);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setToolsLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  const timelineTasks = useMemo<TimelineTask[]>(() => {
    const output: TimelineTask[] = [];
    for (const task of workshopTasks) {
      const createdAt = Date.parse(task.createdAt);
      if (Number.isNaN(createdAt)) continue;
      output.push({
        id: `workshop:${task.id}`,
        title: task.title,
        agent: task.assignedAgent,
        status: task.status,
        createdAt,
        project: t('welcome.workshop', 'Workshop'),
        href: '/workshop',
      });
    }
    for (const session of sessions) {
      for (const message of messagesPerSession[session.key] ?? []) {
        if (message.role !== 'user') continue;
        const createdAt = message.timestamp ? Date.parse(message.timestamp) : 0;
        if (!createdAt) continue;
        const content = typeof message.content === 'string' ? message.content : '';
        output.push({
          id: `chat:${message.id}`,
          title: content.trim().split('\n')[0]?.slice(0, 80) || t('welcome.emptyPrompt', 'Empty prompt'),
          agent: session.label,
          status: 'queued',
          createdAt,
          project: session.label,
          href: '/chat',
        });
      }
    }
    return output;
  }, [messagesPerSession, sessions, t, workshopTasks]);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => (
      project.name.toLocaleLowerCase().includes(normalized)
      || project.path.toLocaleLowerCase().includes(normalized)
    ));
  }, [projects, query]);

  const openProject = useCallback(async (project: WorkspaceProject) => {
    setActionError(null);
    setOpeningPath(project.path);
    try {
      if (onOpenProject) {
        await onOpenProject(project);
      } else {
        await invoke('open_terminal_workspace_directory', { path: project.path });
        navigate('/terminal');
      }
    } catch (error) {
      debugWarn('app', '[WelcomePage] open project failed', error);
      setActionError(t('welcome.openProjectFailed', 'Could not open this project folder.'));
    } finally {
      setOpeningPath(null);
    }
  }, [navigate, onOpenProject, t]);

  const browseForProject = useCallback(async () => {
    setActionError(null);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('welcome.openProjectFolder', 'Open project folder'),
      });
      const path = typeof selected === 'string' ? selected : null;
      if (!path) return;
      const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
      await openProject({ path, name });
    } catch (error) {
      debugWarn('app', '[WelcomePage] project picker failed', error);
      setActionError(t('welcome.openProjectFailed', 'Could not open this project folder.'));
    }
  }, [openProject, t]);

  const removeProject = useCallback(async (path: string) => {
    setActionError(null);
    setRemovingPath(path);
    try {
      await invoke('remove_terminal_recent_workspace', { path });
      setProjects((current) => current.filter((project) => project.path !== path));
    } catch (error) {
      debugWarn('app', '[WelcomePage] remove project failed', error);
      setActionError(t('welcome.removeProjectFailed', 'Could not remove this project from recents.'));
    } finally {
      setRemovingPath(null);
    }
  }, [t]);

  const deleteTodo = useCallback((index: number) => {
    setSavedTodos((current) => {
      const updated = current.filter((_, itemIndex) => itemIndex !== index);
      localStorage.setItem('junqi:saved-todos', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const sidebarItems: Array<{ key: View; icon: React.ReactNode; label: string }> = [
    { key: 'projects', icon: <Layers size={15} />, label: t('welcome.projects', 'Projects') },
    { key: 'timeline', icon: <Clock size={15} />, label: t('welcome.timeline', 'Timeline') },
    { key: 'skills', icon: <Blocks size={15} />, label: t('welcome.skillHub', 'Skill Hub') },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--aegis-bg))]">
      <aside className="flex w-[208px] shrink-0 flex-col border-e border-aegis-border bg-gradient-to-b from-aegis-surface to-aegis-surface-elevated px-3.5 py-4 xl:w-[220px]">
        <div className="mb-3 flex items-center gap-3 border-b border-aegis-border px-1.5 pb-4">
          <JunQiLogo variant="company-emblem" className="h-11 w-11" title="JunQi Desktop" />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold leading-tight text-aegis-text">JunQi</div>
            <div className="mt-0.5 truncate text-[12px] text-aegis-text-dim">
              {t('welcome.agentWorkspace', 'Agent workspace')}
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1" aria-label={t('welcome.workspace', 'Workspace')}>
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold text-aegis-text-dim">
            {t('welcome.workspace', 'Workspace')}
          </div>
          {sidebarItems.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className={`flex h-10 items-center gap-2.5 rounded-md border px-3 text-start text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 ${
                  active
                    ? 'border-aegis-border/70 bg-aegis-hover/55 font-semibold text-aegis-text'
                    : 'border-transparent text-aegis-text-muted hover:bg-aegis-hover/35 hover:text-aegis-text'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 border-t border-aegis-border pt-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            title={t('nav.dashboard', 'Dashboard')}
            aria-label={t('nav.dashboard', 'Dashboard')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
          >
            <LayoutDashboard size={15} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/terminal')}
            title={t('nav.terminal', 'Terminal')}
            aria-label={t('nav.terminal', 'Terminal')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
          >
            <Terminal size={15} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            title={t('nav.settings', 'Settings')}
            aria-label={t('nav.settings', 'Settings')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
          >
            <Settings2 size={15} />
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        {view === 'projects' && (
          <ProjectsView
            projects={projects}
            filteredProjects={filteredProjects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            query={query}
            openingPath={openingPath}
            removingPath={removingPath}
            actionError={actionError}
            tools={tools}
            toolsLoading={toolsLoading}
            savedTodos={savedTodos}
            onQueryChange={setQuery}
            onBrowse={browseForProject}
            onOpenProject={openProject}
            onRemoveProject={removeProject}
            onRetry={refreshProjects}
            onLaunchTool={(tool) => onLaunchTool?.(tool)}
            onOpenTodo={(todo) => {
              const params = new URLSearchParams({ agent: todo.agent, prompt: todo.prompt });
              navigate(`/agent-run?${params.toString()}`);
            }}
            onDeleteTodo={deleteTodo}
          />
        )}
        {view === 'timeline' && (
          <TimelineView
            tasks={timelineTasks}
            title={t('welcome.timeline', 'Timeline')}
            subtitle={t('welcome.timelineSubtitle', 'Recent activity across chat sessions and the workshop.')}
            emptyMessage={t('welcome.timelineEmpty', 'No activity in the past 7 days.')}
          />
        )}
        {view === 'skills' && <SkillsView />}
      </main>
    </div>
  );
}

interface ProjectsViewProps {
  projects: ProjectWithBranch[];
  filteredProjects: ProjectWithBranch[];
  projectsLoading: boolean;
  projectsError: boolean;
  query: string;
  openingPath: string | null;
  removingPath: string | null;
  actionError: string | null;
  tools: CLITool[];
  toolsLoading: boolean;
  savedTodos: SavedTodo[];
  onQueryChange: (query: string) => void;
  onBrowse: () => void;
  onOpenProject: (project: WorkspaceProject) => void;
  onRemoveProject: (path: string) => void;
  onRetry: () => void;
  onLaunchTool: (tool: CLITool) => void;
  onOpenTodo: (todo: SavedTodo) => void;
  onDeleteTodo: (index: number) => void;
}

function ProjectsView({
  projects,
  filteredProjects,
  projectsLoading,
  projectsError,
  query,
  openingPath,
  removingPath,
  actionError,
  tools,
  toolsLoading,
  savedTodos,
  onQueryChange,
  onBrowse,
  onOpenProject,
  onRemoveProject,
  onRetry,
  onLaunchTool,
  onOpenTodo,
  onDeleteTodo,
}: ProjectsViewProps) {
  const { t } = useTranslation();
  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-aegis-border px-[22px] py-[18px]">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 sm:flex-row">
          <label className="flex h-[42px] min-w-0 flex-1 items-center gap-3 rounded-lg border border-aegis-border bg-aegis-input px-4 transition-colors focus-within:border-aegis-primary/60 focus-within:ring-2 focus-within:ring-aegis-primary/15">
            <Search size={15} className="shrink-0 text-aegis-text-dim" />
            <input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t('welcome.searchProjects', 'Search projects')}
              className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-aegis-text outline-none placeholder:font-normal placeholder:text-aegis-text-dim"
            />
          </label>
          <button
            type="button"
            onClick={onBrowse}
            className="flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg border border-aegis-border bg-aegis-surface-elevated px-4 text-[13px] font-semibold text-aegis-text shadow-sm transition-colors hover:bg-aegis-hover/45 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
          >
            <Plus size={14} strokeWidth={2.2} />
            {t('welcome.openProject', 'Open project')}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1600px] px-[22px] pb-6 pt-4">
          {actionError && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/10 px-3 py-2 text-[12px] text-aegis-danger" role="alert">
              <AlertCircle size={14} className="shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          <section aria-labelledby="workspace-projects-heading">
            <div className="mb-2 flex items-end justify-between gap-4">
              <div>
                <h1 id="workspace-projects-heading" className="text-[14px] font-semibold text-aegis-text">
                  {t('welcome.projects', 'Projects')}
                </h1>
                <p className="mt-1 text-[12px] text-aegis-text-dim">
                  {hasQuery
                    ? t('welcome.resultCount', '{{count}} matching projects', { count: filteredProjects.length })
                    : t('welcome.projectCount', '{{count}} recent projects', { count: projects.length })}
                </p>
              </div>
            </div>

            <div>
              {projectsLoading ? (
                <ProjectListSkeleton />
              ) : projectsError ? (
                <WorkspaceEmptyState
                  icon={<AlertCircle size={26} />}
                  title={t('welcome.projectsUnavailable', 'Projects are unavailable')}
                  actionLabel={t('common.retry', 'Retry')}
                  onAction={onRetry}
                />
              ) : filteredProjects.length === 0 ? (
                <WorkspaceEmptyState
                  icon={hasQuery ? <Search size={26} /> : <FolderOpen size={28} />}
                  title={hasQuery
                    ? t('welcome.noMatchingProjects', 'No matching projects')
                    : t('welcome.noProjectsYet', 'No projects yet')}
                  actionLabel={hasQuery ? undefined : t('welcome.openProjectFolder', 'Open project folder')}
                  onAction={hasQuery ? undefined : onBrowse}
                />
              ) : (
                filteredProjects.map((project) => {
                  const opening = openingPath === project.path;
                  const removing = removingPath === project.path;
                  return (
                    <article key={project.path} className="group flex min-w-0 items-center rounded-md border border-transparent transition-colors hover:border-aegis-border/70 hover:bg-aegis-hover/30">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project)}
                        disabled={opening || removing}
                        className="flex min-h-[68px] min-w-0 flex-1 items-center gap-3.5 px-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aegis-primary/40 disabled:cursor-wait"
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white ${projectAvatarClass(project.name)}`} aria-hidden="true">
                          {projectInitials(project.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold text-aegis-text">{project.name}</span>
                          <span className="mt-1 block truncate text-[11.5px] text-aegis-text-dim">{project.path}</span>
                        </span>
                        {project.branch === undefined ? (
                          <span className="h-5 w-14 animate-pulse rounded bg-aegis-overlay/[0.05]" aria-label={t('common.loading', 'Loading')} />
                        ) : project.branch ? (
                          <span className="flex max-w-[160px] shrink-0 items-center gap-1 truncate rounded-full border border-aegis-border bg-aegis-overlay/[0.03] px-2 py-1 text-[10.5px] text-aegis-text-muted">
                            <GitBranch size={10} />
                            <span className="truncate">{project.branch}</span>
                          </span>
                        ) : (
                          <span className="shrink-0 px-2 py-1 text-[10.5px] font-semibold text-aegis-text-dim">
                            {t('welcome.local', 'LOCAL')}
                          </span>
                        )}
                        {opening && <Loader2 size={14} className="shrink-0 animate-spin text-aegis-primary" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveProject(project.path)}
                        disabled={opening || removing}
                        title={t('welcome.removeProject', 'Remove from recents')}
                        aria-label={t('welcome.removeProjectNamed', 'Remove {{name}} from recents', { name: project.name })}
                        className="me-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-aegis-text-dim opacity-0 transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-danger/35 disabled:cursor-wait group-hover:opacity-100"
                      >
                        {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          {savedTodos.length > 0 && (
            <section className="mt-7" aria-labelledby="saved-prompts-heading">
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h2 id="saved-prompts-heading" className="text-[13px] font-semibold text-aegis-text">
                  {t('welcome.savedPrompts', 'Saved prompts')}
                </h2>
                <span className="font-mono text-[10px] text-aegis-text-dim">{savedTodos.length}</span>
              </div>
              <div className="border-y border-aegis-border">
                {savedTodos.map((todo, index) => (
                  <div key={`${todo.at}:${index}`} className="flex h-11 items-center gap-2 border-b border-aegis-border px-2 last:border-b-0">
                    <span className="shrink-0 rounded bg-aegis-overlay/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] text-aegis-text-dim">{todo.agent}</span>
                    <button type="button" onClick={() => onOpenTodo(todo)} className="min-w-0 flex-1 truncate text-start text-[11.5px] text-aegis-text-secondary hover:text-aegis-text focus-visible:outline-none focus-visible:underline">
                      {todo.prompt}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteTodo(index)}
                      title={t('common.delete', 'Delete')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-aegis-text-dim hover:bg-aegis-danger/10 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-danger/35"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <details className="group/tools mt-7 border-y border-aegis-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-2 text-[12px] font-semibold text-aegis-text marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aegis-primary/40">
              <Terminal size={14} className="text-aegis-text-muted" />
              <span className="flex-1">{t('welcome.localCliTools', 'Local CLI tools')}</span>
              <span className="font-mono text-[10px] font-normal text-aegis-text-dim">
                {toolsLoading ? t('welcome.detecting', 'Detecting') : tools.length}
              </span>
              <ChevronDown size={13} className="text-aegis-text-dim transition-transform group-open/tools:rotate-180" />
            </summary>
            <div className="border-t border-aegis-border px-2 py-3">
              {toolsLoading ? (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-md bg-aegis-overlay/[0.04]" />)}
                </div>
              ) : tools.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-[11.5px] text-aegis-text-dim">
                  <Inbox size={15} />
                  {t('welcome.noTools', 'No local CLI tools detected')}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {tools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => onLaunchTool(tool)}
                      title={t('welcome.runTool', 'Run {{tool}} in Terminal', { tool: tool.label })}
                      className="flex h-10 min-w-0 items-center gap-2.5 rounded-md px-2 text-start transition-colors hover:bg-aegis-hover/35 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-aegis-overlay/[0.05] text-aegis-text-muted">{tool.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium text-aegis-text-secondary">{tool.label}</span>
                        <span className="block truncate font-mono text-[9.5px] text-aegis-text-dim">{tool.cmd.trim()}</span>
                      </span>
                      <ArrowRight size={12} className="shrink-0 text-aegis-text-dim" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function ProjectListSkeleton() {
  return (
    <div aria-label="Loading projects">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex min-h-[68px] items-center gap-3.5 px-3 py-2">
          <span className="h-9 w-9 animate-pulse rounded-md bg-aegis-overlay/[0.05]" />
          <span className="min-w-0 flex-1">
            <span className="block h-3 w-32 animate-pulse rounded bg-aegis-overlay/[0.06]" />
            <span className="mt-2 block h-2.5 w-2/3 animate-pulse rounded bg-aegis-overlay/[0.04]" />
          </span>
          <span className="h-5 w-14 animate-pulse rounded bg-aegis-overlay/[0.04]" />
        </div>
      ))}
    </div>
  );
}

function WorkspaceEmptyState({
  icon,
  title,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <span className="text-aegis-text-dim opacity-55">{icon}</span>
      <div className="text-[12.5px] font-medium text-aegis-text-secondary">{title}</div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[11px] font-semibold text-aegis-text-secondary hover:bg-aegis-hover/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
        >
          <FolderOpen size={13} />
          {actionLabel}
        </button>
      )}
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
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-aegis-border px-6 py-4">
        <div>
          <h1 className="text-[15px] font-semibold text-aegis-text">{t('welcome.skillHub', 'Skill Hub')}</h1>
          <p className="mt-0.5 text-[11px] text-aegis-text-dim">
            {loading
              ? t('common.loading', 'Loading')
              : t('welcome.skillCount', '{{count}} skills', { count: skills.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/skill-hub')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[11px] font-semibold text-aegis-text-secondary hover:bg-aegis-hover/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
        >
          {t('common.manage', 'Manage')}
          <ArrowRight size={12} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={16} className="animate-spin text-aegis-text-dim" />
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Blocks size={30} className="text-aegis-text-dim opacity-40" />
            <div className="text-[12px] text-aegis-text-dim">{t('welcome.noSkills', 'No skills found')}</div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[900px] flex-col border-y border-aegis-border">
            {skills.map((skill) => (
              <div key={skill.name} className="flex min-h-12 items-center gap-3 border-b border-aegis-border px-2 last:border-b-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-aegis-overlay/[0.05] text-aegis-text-muted">
                  <Cube size={14} weight="regular" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-aegis-text">{skill.displayName ?? skill.name}</div>
                  {skill.description && <div className="truncate text-[10px] text-aegis-text-dim">{skill.description}</div>}
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
