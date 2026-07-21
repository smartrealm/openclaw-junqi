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
  newPaneId,
  newSshWorkspace,
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
import { workspacePathKey } from '@/workspace/projectWorkspace';

export interface TerminalWorktreeDescriptor {
  path: string;
  branch: string;
  name: string;
}

interface WorkspaceStoreState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  /** Runtime fallback supplied by TerminalPage after Tauri resolves $HOME. */
  defaultWorkingDirectory: string;

  ensureActive: (workingDirectory?: string) => Workspace;
  setDefaultWorkingDirectory: (workingDirectory: string) => void;
  setActive: (id: string) => void;
  createWorkspace: (name?: string, workingDirectory?: string) => Workspace;
  createSshWorkspace: (host: string) => Workspace | null;
  createWorktreeWorkspace: (parentId: string, branch: string, workingDirectory: string) => Workspace | null;
  adoptWorktreeWorkspaces: (parentId: string, worktrees: readonly TerminalWorktreeDescriptor[]) => void;
  reconcileWorktreeFamily: (parentId: string, worktrees: readonly TerminalWorktreeDescriptor[]) => void;
  closeWorkspace: (id: string) => void;
  closeOtherWorkspaces: (id: string) => void;
  duplicateWorkspace: (id: string) => Workspace | null;
  splitPane: (
    leafId: string,
    direction: SplitDirection,
    newLeafConfig?: Partial<LeafConfig>,
    workspaceId?: string,
  ) => string | null;
  closePane: (leafId: string, workspaceId?: string) => void;
  setFocus: (leafId: string, workspaceId?: string) => void;
  toggleZoom: (paneId?: string, workspaceId?: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  updateLeafConfig: (leafId: string, patch: Partial<LeafConfig>, workspaceId?: string) => void;
  setPaneCwd: (leafId: string, cwd: string, workspaceId?: string) => void;
  addShellPane: () => string | null;
  addAgentPane: (agent?: string) => string | null;
  renameWorkspace: (id: string, name: string) => void;
  toggleWorkspaceHidden: (id: string) => void;
  moveWorkspace: (workspaceId: string, targetWorkspaceId: string, position?: 'before' | 'after') => void;
}

// v5 persists Kooky-style worktree ownership alongside the immutable project
// root. Runtime-only zoom remains deliberately excluded below.
const WORKSPACE_PERSISTENCE_VERSION = 5;

function workspacePersistenceKey(): string {
  if (typeof window === 'undefined') return 'workspace:v1';
  const label = (window as Window & { __JUNQI_TERMINAL_WINDOW_LABEL__?: unknown })
    .__JUNQI_TERMINAL_WINDOW_LABEL__;
  return typeof label === 'string' && label.startsWith('terminal-')
    ? `workspace:v1:${label}`
    : 'workspace:v1';
}

function nonEmptyText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function nonEmptyPath(value: string | undefined | null): string {
  return value && value.length > 0 ? value : '';
}

function activeWorkspace(state: Pick<WorkspaceStoreState, 'workspaces' | 'activeWorkspaceId'>): Workspace | null {
  return state.activeWorkspaceId
    ? state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null
    : null;
}

function currentPaneCwd(workspace: Workspace, leafId: string, fallback: string): string {
  if (workspace.sshRemoteHost) return '';
  return nonEmptyPath(findLeaf(workspace.root, leafId)?.config.cwd)
    || nonEmptyPath(workspace.workingDirectory)
    || nonEmptyPath(fallback);
}

function hydrateWorkspaceCwds(workspace: Workspace, fallback: string): Workspace {
  // SSH workspace panes have a remote cwd which is neither meaningful nor
  // safe to persist as a local filesystem path. Older state may have gained a
  // fallback cwd while activating the workspace; remove it during hydration.
  if (workspace.sshRemoteHost) {
    const root = mapLeaves(workspace.root, (leaf) => {
      if (!leaf.config.cwd) return leaf;
      const { cwd: _cwd, ...config } = leaf.config;
      return { ...leaf, config };
    });
    const leafIds = listLeafIds(root);
    const focusedPaneId = leafIds.includes(workspace.focusedPaneId)
      ? workspace.focusedPaneId
      : leafIds[0];
    if (
      root === workspace.root
      && workspace.workingDirectory === ''
      && workspace.projectDirectory === ''
      && focusedPaneId === workspace.focusedPaneId
    ) {
      return workspace;
    }
    return {
      ...workspace,
      projectDirectory: '',
      workingDirectory: '',
      root,
      focusedPaneId,
    };
  }
  const rootLeafId = listLeafIds(workspace.root)[0];
  const inferred = nonEmptyPath(workspace.workingDirectory)
    || nonEmptyPath(findLeaf(workspace.root, rootLeafId)?.config.cwd)
    || nonEmptyPath(fallback);
  const root = inferred
    ? mapLeaves(workspace.root, (leaf) => (
      nonEmptyPath(leaf.config.cwd)
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
    cwd: nonEmptyPath(config.cwd) || cwd,
    label: nonEmptyText(config.label) || (kind === 'shell' ? 'Shell' : 'Agent'),
    ...(nonEmptyText(config.resumeId) ? { resumeId: nonEmptyText(config.resumeId) } : {}),
  });
}

function makeWorktreeWorkspace(
  parent: Workspace,
  descriptor: TerminalWorktreeDescriptor,
): Workspace | null {
  const directory = nonEmptyPath(descriptor.path);
  const branch = nonEmptyText(descriptor.branch) || 'detached';
  if (!directory) return null;
  const root = defaultLeaf('shell', undefined, directory);
  return {
    id: newPaneId(),
    name: nonEmptyText(descriptor.name) || branch,
    projectDirectory: parent.projectDirectory || parent.workingDirectory,
    workingDirectory: directory,
    root,
    focusedPaneId: root.id,
    worktreeParentId: parent.id,
    worktreeBranch: branch,
    worktreePath: directory,
  };
}

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,
      defaultWorkingDirectory: '',

      ensureActive: (workingDirectory) => {
        const state = get();
        const fallback = nonEmptyPath(workingDirectory) || state.defaultWorkingDirectory;
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

        const fresh = newWorkspace(undefined, fallback);
        set({ workspaces: [fresh], activeWorkspaceId: fresh.id });
        return fresh;
      },

      setDefaultWorkingDirectory: (workingDirectory) => {
        const normalized = nonEmptyPath(workingDirectory);
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
        const fresh = newWorkspace(name, nonEmptyPath(workingDirectory) || inheritedCwd);
        set((current) => ({
          workspaces: [...current.workspaces, fresh],
          activeWorkspaceId: fresh.id,
        }));
        return fresh;
      },

      createSshWorkspace: (host) => {
        const destination = nonEmptyText(host);
        if (!destination || /[\u0000-\u001f\u007f]/.test(destination)) return null;
        const fresh = newSshWorkspace(destination);
        set((current) => ({
          workspaces: [...current.workspaces, fresh],
          activeWorkspaceId: fresh.id,
        }));
        return fresh;
      },

      createWorktreeWorkspace: (parentId, branch, workingDirectory) => {
        const state = get();
        const parent = state.workspaces.find((workspace) => workspace.id === parentId);
        const directory = nonEmptyPath(workingDirectory);
        const normalizedBranch = nonEmptyText(branch);
        if (!parent || !directory || !normalizedBranch || parent.worktreeParentId) return null;
        const child = makeWorktreeWorkspace(parent, {
          path: directory,
          branch: normalizedBranch,
          name: normalizedBranch,
        });
        if (!child) return null;
        set((current) => {
          const parentIndex = current.workspaces.findIndex((workspace) => workspace.id === parent.id);
          const afterFamily = current.workspaces.findIndex((workspace, index) => (
            index > parentIndex && workspace.worktreeParentId !== parent.id
          ));
          const insertAt = afterFamily === -1 ? current.workspaces.length : afterFamily;
          return {
            workspaces: [
              ...current.workspaces.slice(0, insertAt),
              child,
              ...current.workspaces.slice(insertAt),
            ],
            activeWorkspaceId: child.id,
          };
        });
        return child;
      },

      adoptWorktreeWorkspaces: (parentId, descriptors) => set((state) => {
        const parent = state.workspaces.find((workspace) => workspace.id === parentId);
        if (!parent || parent.worktreeParentId || parent.sshRemoteHost) return {};
        const existingChildren = state.workspaces.filter((workspace) => workspace.worktreeParentId === parent.id);
        const knownPaths = new Set(existingChildren.map((workspace) => workspacePathKey(workspace.worktreePath || workspace.workingDirectory)));
        const additions: Workspace[] = [];
        for (const descriptor of descriptors) {
          const path = workspacePathKey(descriptor.path);
          if (!path || knownPaths.has(path)) continue;
          const child = makeWorktreeWorkspace(parent, descriptor);
          if (!child) continue;
          knownPaths.add(path);
          additions.push(child);
        }
        if (additions.length === 0) return {};
        const parentIndex = state.workspaces.findIndex((workspace) => workspace.id === parent.id);
        if (parentIndex < 0) return {};
        let insertAt = parentIndex + 1;
        while (state.workspaces[insertAt]?.worktreeParentId === parent.id) insertAt += 1;
        return {
          workspaces: [
            ...state.workspaces.slice(0, insertAt),
            ...additions,
            ...state.workspaces.slice(insertAt),
          ],
          activeWorkspaceId: additions[additions.length - 1]!.id,
        };
      }),

      reconcileWorktreeFamily: (parentId, worktrees) => set((state) => {
        const parent = state.workspaces.find((workspace) => workspace.id === parentId);
        if (!parent || parent.worktreeParentId || parent.sshRemoteHost) return {};

        const existingChildren = state.workspaces.filter((workspace) => workspace.worktreeParentId === parent.id);
        const diskByPath = new Map(worktrees.map((descriptor) => [workspacePathKey(descriptor.path), descriptor]));
        // Kooky v0.19+ treats the sidebar as the source of truth. Discovery
        // only prunes stale adopted children; it never auto-adopts every CLI
        // worktree found on disk.
        const children = existingChildren.flatMap((existing) => {
          const descriptor = diskByPath.get(workspacePathKey(existing.worktreePath || existing.workingDirectory));
          if (!descriptor) return [];
          const branch = nonEmptyText(descriptor.branch) || 'detached';
          return [{
            ...existing,
            projectDirectory: parent.projectDirectory || parent.workingDirectory,
            workingDirectory: descriptor.path,
            worktreePath: descriptor.path,
            worktreeBranch: branch,
          }];
        });

        const retained = state.workspaces.filter((workspace) => workspace.worktreeParentId !== parent.id);
        const parentIndex = retained.findIndex((workspace) => workspace.id === parent.id);
        if (parentIndex < 0) return {};
        const workspaces = [
          ...retained.slice(0, parentIndex + 1),
          ...children,
          ...retained.slice(parentIndex + 1),
        ];
        const currentChildIds = existingChildren.map((workspace) => workspace.id);
        const nextChildIds = children.map((workspace) => workspace.id);
        const unchanged = currentChildIds.length === nextChildIds.length
          && currentChildIds.every((id, index) => id === nextChildIds[index])
          && children.every((child) => {
            const previous = existingChildren.find((workspace) => workspace.id === child.id);
            return previous
              && previous.workingDirectory === child.workingDirectory
              && previous.worktreePath === child.worktreePath
              && previous.worktreeBranch === child.worktreeBranch
              && previous.projectDirectory === child.projectDirectory;
          });
        if (unchanged) return {};

        const activeWorkspaceId = state.activeWorkspaceId && currentChildIds.includes(state.activeWorkspaceId)
          && !nextChildIds.includes(state.activeWorkspaceId)
          ? parent.id
          : state.activeWorkspaceId;
        return { workspaces, activeWorkspaceId };
      }),

      closeWorkspace: (id) => set((state) => {
        const index = state.workspaces.findIndex((workspace) => workspace.id === id);
        if (index === -1) return {};
        const closingIds = new Set<string>([id]);
        // A source owns its worktree rows. Closing it from any UI entry point
        // removes the entire in-memory family rather than leaving an orphan
        // sidebar row that no longer has a project source.
        for (const workspace of state.workspaces) {
          if (workspace.worktreeParentId === id) closingIds.add(workspace.id);
        }
        const remaining = state.workspaces.filter((workspace) => !closingIds.has(workspace.id));
        if (remaining.length === 0) {
          const fresh = newWorkspace(undefined, state.defaultWorkingDirectory);
          return { workspaces: [fresh], activeWorkspaceId: fresh.id };
        }
        const next = remaining[Math.min(index, remaining.length - 1)];
        return {
          workspaces: remaining,
          activeWorkspaceId: state.activeWorkspaceId && closingIds.has(state.activeWorkspaceId)
            ? next.id
            : state.activeWorkspaceId,
        };
      }),

      closeOtherWorkspaces: (id) => set((state) => {
        const selected = state.workspaces.find((workspace) => workspace.id === id);
        if (!selected) return {};
        const sourceId = selected.worktreeParentId ?? selected.id;
        const keepIds = new Set(
          state.workspaces
            .filter((workspace) => workspace.id === sourceId || workspace.worktreeParentId === sourceId)
            .map((workspace) => workspace.id),
        );
        const workspaces = state.workspaces.filter((workspace) => keepIds.has(workspace.id));
        return {
          workspaces,
          activeWorkspaceId: keepIds.has(state.activeWorkspaceId ?? '') ? state.activeWorkspaceId : sourceId,
        };
      }),

      duplicateWorkspace: (id) => {
        const source = get().workspaces.find((workspace) => workspace.id === id);
        if (!source) return null;
        const duplicate = source.sshRemoteHost
          ? newSshWorkspace(source.sshRemoteHost)
          : newWorkspace(source.name, source.projectDirectory || source.workingDirectory);
        set((state) => ({
          workspaces: [...state.workspaces, duplicate],
          activeWorkspaceId: duplicate.id,
        }));
        return duplicate;
      },

      splitPane: (leafId, direction, newLeafConfig, workspaceId) => {
        const state = get();
        const workspace = workspaceId
          ? state.workspaces.find((candidate) => candidate.id === workspaceId) ?? null
          : activeWorkspace(state);
        if (!workspace) return null;
        const source = findLeaf(workspace.root, leafId);
        if (!source) return null;
        const cwd = workspace.sshRemoteHost
          ? ''
          : currentPaneCwd(workspace, leafId, state.defaultWorkingDirectory);
        const newLeaf = makeLeaf(newLeafConfig ?? {}, cwd);
        set((current) => updateWorkspace(current, workspace.id, (active) => ({
          ...active,
          root: splitLeaf(active.root, leafId, direction, newLeaf),
          focusedPaneId: newLeaf.id,
          workingDirectory: cwd || active.workingDirectory,
          zoomedPaneId: undefined,
        })));
        return newLeaf.id;
      },

      closePane: (leafId, workspaceId) => set((state) => updateWorkspace(state, workspaceId, (workspace) => {
        const before = listLeafIds(workspace.root);
        if (!before.includes(leafId)) return workspace;
        const collapsed = removeLeaf(workspace.root, leafId);
        const root: PaneNode = collapsed ?? defaultLeaf(
          'shell',
          undefined,
          workspace.sshRemoteHost ? '' : workspace.workingDirectory || state.defaultWorkingDirectory,
        );
        const remaining = listLeafIds(root);
        const focusedPaneId = remaining.includes(workspace.focusedPaneId)
          ? workspace.focusedPaneId
          : nearestRemainingPane(before, leafId, remaining) ?? remaining[0];
        const workingDirectory = currentPaneCwd(
          { ...workspace, root, focusedPaneId },
          focusedPaneId,
          state.defaultWorkingDirectory,
        );
        return {
          ...workspace,
          root,
          focusedPaneId,
          workingDirectory,
          zoomedPaneId: workspace.zoomedPaneId === leafId ? undefined : workspace.zoomedPaneId,
        };
      })),

      setFocus: (leafId, workspaceId) => set((state) => updateWorkspace(state, workspaceId, (workspace) => {
        if (!findLeaf(workspace.root, leafId)) return workspace;
        return {
          ...workspace,
          focusedPaneId: leafId,
          workingDirectory: currentPaneCwd(workspace, leafId, state.defaultWorkingDirectory),
          zoomedPaneId: workspace.zoomedPaneId && workspace.zoomedPaneId !== leafId
            ? undefined
            : workspace.zoomedPaneId,
        };
      })),

      toggleZoom: (paneId, workspaceId) => set((state) => updateWorkspace(state, workspaceId, (workspace) => {
        const targetPaneId = paneId ?? workspace.focusedPaneId;
        if (!findLeaf(workspace.root, targetPaneId)) return workspace;
        const isCurrent = workspace.zoomedPaneId === targetPaneId;
        if (!isCurrent && listLeafIds(workspace.root).length < 2) return workspace;
        return {
          ...workspace,
          focusedPaneId: targetPaneId,
          workingDirectory: currentPaneCwd(workspace, targetPaneId, state.defaultWorkingDirectory),
          zoomedPaneId: isCurrent ? undefined : targetPaneId,
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
        const mergedConfig: LeafConfig = {
          ...leaf.config,
          ...patch,
          kind,
          ...(kind === 'shell' ? { agent: undefined } : {}),
        };
        const nextConfig = workspace.sshRemoteHost
          ? (() => {
            const { cwd: _cwd, ...config } = mergedConfig;
            return config;
          })()
          : mergedConfig;
        const root = replaceNode(workspace.root, leafId, {
          type: 'leaf',
          id: leaf.id,
          config: nextConfig,
        });
        const cwd = workspace.sshRemoteHost ? '' : nonEmptyPath(mergedConfig.cwd);
        return {
          ...workspace,
          root,
          workingDirectory: !workspace.sshRemoteHost && workspace.focusedPaneId === leafId && cwd
            ? cwd
            : workspace.workingDirectory,
        };
      })),

      setPaneCwd: (leafId, cwd, workspaceId) => {
        const normalized = nonEmptyPath(cwd);
        if (!normalized) return;
        const workspace = workspaceId
          ? get().workspaces.find((candidate) => candidate.id === workspaceId)
          : activeWorkspace(get());
        if (workspace?.sshRemoteHost) return;
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
        const normalized = nonEmptyText(name);
        if (!normalized) return;
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => (
            workspace.id === id ? { ...workspace, name: normalized } : workspace
          )),
        }));
      },

      toggleWorkspaceHidden: (id) => set((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === id ? { ...workspace, hiddenFromRail: !workspace.hiddenFromRail } : workspace
        )),
      })),

      moveWorkspace: (workspaceId, targetWorkspaceId, position = 'before') => set((state) => {
        if (workspaceId === targetWorkspaceId) return {};
        const moving = state.workspaces.find((workspace) => workspace.id === workspaceId);
        const target = state.workspaces.find((workspace) => workspace.id === targetWorkspaceId);
        // Worktree rows stay attached to their source. This mirrors Kooky's
        // hierarchy and prevents a reordered child from becoming orphaned.
        if (!moving || !target || moving.worktreeParentId || target.worktreeParentId) return {};

        const movingFamily = state.workspaces.filter((workspace) => (
          workspace.id === moving.id || workspace.worktreeParentId === moving.id
        ));
        const remaining = state.workspaces.filter((workspace) => !movingFamily.includes(workspace));
        const targetIndex = remaining.findIndex((workspace) => workspace.id === targetWorkspaceId);
        if (targetIndex < 0) return {};
        const targetFamilyLength = remaining.filter((workspace, index) => (
          index > targetIndex && workspace.worktreeParentId === targetWorkspaceId
        )).length;
        const insertAt = position === 'after' ? targetIndex + targetFamilyLength + 1 : targetIndex;

        return {
          workspaces: [
            ...remaining.slice(0, insertAt),
            ...movingFamily,
            ...remaining.slice(insertAt),
          ],
        };
      }),
    }),
    {
      // Kooky creates one WorkspaceStore per native window. Terminal windows
      // share the same origin in Tauri, so isolate their Zustand persistence
      // key explicitly instead of letting them mutate the main layout.
      name: workspacePersistenceKey(),
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
        // Zoom is a transient layout state. Persisting it would reopen the app
        // with panes hidden and mirrors Kooky's runtime-only zoom ownership.
        workspaces: state.workspaces.map(({ zoomedPaneId: _zoomedPaneId, ...workspace }) => workspace),
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    },
  ),
);
