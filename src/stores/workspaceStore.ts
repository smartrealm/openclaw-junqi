// Workspace store.
//
// This follows Kooky's ownership model: a workspace owns a stable split tree;
// every pane owns its current directory; the active pane's directory becomes
// the workspace default for new panes and new workspaces.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createLeaf,
  defaultLeaf,
  findLeaf,
  listLeafIds,
  mapLeaves,
  newWorkspace,
  normalizeWorkspaces,
  removeLeaf,
  replaceNode,
  resizeSplit,
  splitLeaf,
  type LeafConfig,
  type PaneLeaf,
  type PaneNode,
  type SplitDirection,
  type Workspace,
} from '@/workspace/types';

interface WorkspaceStoreState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  /** Runtime fallback supplied by TerminalPage after Tauri resolves $HOME. */
  defaultWorkingDirectory: string;

  ensureActive: (workingDirectory?: string) => Workspace;
  setDefaultWorkingDirectory: (workingDirectory: string) => void;
  setActive: (id: string) => void;
  createWorkspace: (name?: string, workingDirectory?: string) => Workspace;
  closeWorkspace: (id: string) => void;
  splitPane: (
    leafId: string,
    direction: SplitDirection,
    newLeafConfig?: Partial<LeafConfig>,
    workspaceId?: string,
  ) => string | null;
  closePane: (leafId: string, workspaceId?: string) => void;
  setFocus: (leafId: string, workspaceId?: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  updateLeafConfig: (leafId: string, patch: Partial<LeafConfig>, workspaceId?: string) => void;
  setPaneCwd: (leafId: string, cwd: string, workspaceId?: string) => void;
  addShellPane: () => string | null;
  addAgentPane: (agent?: string) => string | null;
  renameWorkspace: (id: string, name: string) => void;
}

// v3 globally de-duplicates pane ids because inactive workspaces now remain
// mounted and share the same terminal persistence and PTY registries.
const WORKSPACE_PERSISTENCE_VERSION = 3;

function nonEmpty(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function activeWorkspace(state: Pick<WorkspaceStoreState, 'workspaces' | 'activeWorkspaceId'>): Workspace | null {
  return state.activeWorkspaceId
    ? state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null
    : null;
}

function currentPaneCwd(workspace: Workspace, leafId: string, fallback: string): string {
  return nonEmpty(findLeaf(workspace.root, leafId)?.config.cwd)
    || nonEmpty(workspace.workingDirectory)
    || nonEmpty(fallback);
}

function hydrateWorkspaceCwds(workspace: Workspace, fallback: string): Workspace {
  const rootLeafId = listLeafIds(workspace.root)[0];
  const inferred = nonEmpty(workspace.workingDirectory)
    || nonEmpty(findLeaf(workspace.root, rootLeafId)?.config.cwd)
    || nonEmpty(fallback);
  const root = inferred
    ? mapLeaves(workspace.root, (leaf) => (
      nonEmpty(leaf.config.cwd)
        ? leaf
        : { ...leaf, config: { ...leaf.config, cwd: inferred } }
    ))
    : workspace.root;
  const leafIds = listLeafIds(root);
  const focusedPaneId = leafIds.includes(workspace.focusedPaneId)
    ? workspace.focusedPaneId
    : leafIds[0];

  if (
    root === workspace.root
    && inferred === workspace.workingDirectory
    && focusedPaneId === workspace.focusedPaneId
  ) {
    return workspace;
  }
  return { ...workspace, workingDirectory: inferred, root, focusedPaneId };
}

function updateActive(
  state: WorkspaceStoreState,
  transform: (workspace: Workspace) => Workspace,
): Pick<WorkspaceStoreState, 'workspaces'> {
  if (!state.activeWorkspaceId) return { workspaces: state.workspaces };
  return {
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId ? transform(workspace) : workspace
    )),
  };
}

function updateWorkspace(
  state: WorkspaceStoreState,
  workspaceId: string | undefined,
  transform: (workspace: Workspace) => Workspace,
): Pick<WorkspaceStoreState, 'workspaces'> {
  const targetId = workspaceId ?? state.activeWorkspaceId;
  if (!targetId) return { workspaces: state.workspaces };
  return {
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === targetId ? transform(workspace) : workspace
    )),
  };
}

function nearestRemainingPane(before: string[], closedId: string, remaining: string[]): string | null {
  const index = before.indexOf(closedId);
  if (index === -1) return remaining[0] ?? null;
  for (let offset = 1; offset < before.length; offset += 1) {
    const next = before[index + offset];
    if (next && remaining.includes(next)) return next;
    const previous = before[index - offset];
    if (previous && remaining.includes(previous)) return previous;
  }
  return remaining[0] ?? null;
}

function makeLeaf(config: Partial<LeafConfig>, cwd: string): PaneLeaf {
  const kind = config.kind === 'agent' ? 'agent' : 'shell';
  return createLeaf({
    kind,
    ...(kind === 'agent' && config.agent ? { agent: config.agent } : {}),
    cwd: nonEmpty(config.cwd) || cwd,
    label: nonEmpty(config.label) || (kind === 'shell' ? 'Shell' : 'Agent'),
    ...(nonEmpty(config.resumeId) ? { resumeId: nonEmpty(config.resumeId) } : {}),
  });
}

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,
      defaultWorkingDirectory: '',

      ensureActive: (workingDirectory) => {
        const state = get();
        const fallback = nonEmpty(workingDirectory) || state.defaultWorkingDirectory;
        const current = activeWorkspace(state);
        if (current) {
          const hydrated = hydrateWorkspaceCwds(current, fallback);
          if (hydrated !== current) {
            set({
              workspaces: state.workspaces.map((workspace) => (
                workspace.id === current.id ? hydrated : workspace
              )),
            });
          }
          return hydrated;
        }

        const fresh = newWorkspace('Workspace', fallback);
        set({ workspaces: [fresh], activeWorkspaceId: fresh.id });
        return fresh;
      },

      setDefaultWorkingDirectory: (workingDirectory) => {
        const normalized = nonEmpty(workingDirectory);
        if (!normalized) return;
        set((state) => {
          const workspaces = state.workspaces.map((workspace) => hydrateWorkspaceCwds(workspace, normalized));
          const unchanged = state.defaultWorkingDirectory === normalized
            && workspaces.every((workspace, index) => workspace === state.workspaces[index]);
          return unchanged ? {} : { defaultWorkingDirectory: normalized, workspaces };
        });
      },

      setActive: (id) => set((state) => {
        const selected = state.workspaces.find((workspace) => workspace.id === id);
        if (!selected) return {};
        const cwd = currentPaneCwd(selected, selected.focusedPaneId, state.defaultWorkingDirectory);
        const hydrated = hydrateWorkspaceCwds(
          cwd && selected.workingDirectory !== cwd ? { ...selected, workingDirectory: cwd } : selected,
          state.defaultWorkingDirectory,
        );
        return {
          activeWorkspaceId: id,
          workspaces: state.workspaces.map((workspace) => workspace.id === id ? hydrated : workspace),
        };
      }),

      createWorkspace: (name, workingDirectory) => {
        const state = get();
        const source = activeWorkspace(state);
        const inheritedCwd = source
          ? currentPaneCwd(source, source.focusedPaneId, state.defaultWorkingDirectory)
          : state.defaultWorkingDirectory;
        const fresh = newWorkspace(name, nonEmpty(workingDirectory) || inheritedCwd);
        set((current) => ({
          workspaces: [...current.workspaces, fresh],
          activeWorkspaceId: fresh.id,
        }));
        return fresh;
      },

      closeWorkspace: (id) => set((state) => {
        const index = state.workspaces.findIndex((workspace) => workspace.id === id);
        if (index === -1) return {};
        const remaining = state.workspaces.filter((workspace) => workspace.id !== id);
        if (remaining.length === 0) {
          const fresh = newWorkspace('Workspace', state.defaultWorkingDirectory);
          return { workspaces: [fresh], activeWorkspaceId: fresh.id };
        }
        const next = remaining[Math.min(index, remaining.length - 1)];
        return {
          workspaces: remaining,
          activeWorkspaceId: state.activeWorkspaceId === id ? next.id : state.activeWorkspaceId,
        };
      }),

      splitPane: (leafId, direction, newLeafConfig, workspaceId) => {
        const state = get();
        const workspace = workspaceId
          ? state.workspaces.find((candidate) => candidate.id === workspaceId) ?? null
          : activeWorkspace(state);
        if (!workspace) return null;
        const source = findLeaf(workspace.root, leafId);
        if (!source) return null;
        const cwd = currentPaneCwd(workspace, leafId, state.defaultWorkingDirectory);
        const newLeaf = makeLeaf(newLeafConfig ?? {}, cwd);
        set((current) => updateWorkspace(current, workspace.id, (active) => ({
          ...active,
          root: splitLeaf(active.root, leafId, direction, newLeaf),
          focusedPaneId: newLeaf.id,
          workingDirectory: cwd || active.workingDirectory,
        })));
        return newLeaf.id;
      },

      closePane: (leafId, workspaceId) => set((state) => updateWorkspace(state, workspaceId, (workspace) => {
        const before = listLeafIds(workspace.root);
        if (!before.includes(leafId)) return workspace;
        const collapsed = removeLeaf(workspace.root, leafId);
        const root: PaneNode = collapsed ?? defaultLeaf('shell', undefined, workspace.workingDirectory || state.defaultWorkingDirectory);
        const remaining = listLeafIds(root);
        const focusedPaneId = remaining.includes(workspace.focusedPaneId)
          ? workspace.focusedPaneId
          : nearestRemainingPane(before, leafId, remaining) ?? remaining[0];
        const workingDirectory = currentPaneCwd(
          { ...workspace, root, focusedPaneId },
          focusedPaneId,
          state.defaultWorkingDirectory,
        );
        return { ...workspace, root, focusedPaneId, workingDirectory };
      })),

      setFocus: (leafId, workspaceId) => set((state) => updateWorkspace(state, workspaceId, (workspace) => {
        if (!findLeaf(workspace.root, leafId)) return workspace;
        return {
          ...workspace,
          focusedPaneId: leafId,
          workingDirectory: currentPaneCwd(workspace, leafId, state.defaultWorkingDirectory),
        };
      })),

      resizeSplit: (splitId, ratio) => set((state) => updateActive(state, (workspace) => ({
        ...workspace,
        root: resizeSplit(workspace.root, splitId, ratio),
      }))),

      updateLeafConfig: (leafId, patch, workspaceId) => set((state) => updateWorkspace(state, workspaceId, (workspace) => {
        const leaf = findLeaf(workspace.root, leafId);
        if (!leaf) return workspace;
        const kind = patch.kind ?? leaf.config.kind;
        const nextConfig: LeafConfig = {
          ...leaf.config,
          ...patch,
          kind,
          ...(kind === 'shell' ? { agent: undefined } : {}),
        };
        const root = replaceNode(workspace.root, leafId, {
          type: 'leaf',
          id: leaf.id,
          config: nextConfig,
        });
        const cwd = nonEmpty(nextConfig.cwd);
        return {
          ...workspace,
          root,
          workingDirectory: workspace.focusedPaneId === leafId && cwd ? cwd : workspace.workingDirectory,
        };
      })),

      setPaneCwd: (leafId, cwd, workspaceId) => {
        const normalized = nonEmpty(cwd);
        if (!normalized) return;
        get().updateLeafConfig(leafId, { cwd: normalized }, workspaceId);
      },

      addShellPane: () => get().splitPane(
        activeWorkspace(get())?.focusedPaneId ?? '',
        'horizontal',
        { kind: 'shell', label: 'Shell' },
      ),

      addAgentPane: (agent) => get().splitPane(
        activeWorkspace(get())?.focusedPaneId ?? '',
        'vertical',
        {
          kind: 'agent',
          label: agent?.trim() || 'Agent',
          agent: (agent === 'codex' || agent === 'pi' ? agent : 'claude'),
        },
      ),

      renameWorkspace: (id, name) => {
        const normalized = nonEmpty(name);
        if (!normalized) return;
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => (
            workspace.id === id ? { ...workspace, name: normalized } : workspace
          )),
        }));
      },
    }),
    {
      name: 'workspace:v1',
      version: WORKSPACE_PERSISTENCE_VERSION,
      migrate: (persisted) => {
        const state = (persisted as Partial<WorkspaceStoreState>) ?? {};
        const workspaces = normalizeWorkspaces(state.workspaces);
        const activeWorkspaceId = typeof state.activeWorkspaceId === 'string'
          && workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
          ? state.activeWorkspaceId
          : workspaces[0]?.id ?? null;
        return { workspaces, activeWorkspaceId };
      },
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    },
  ),
);
