// ─────────────────────────────────────────────────────────────────
// workspaceStore — multi-pane workspace state (kooky-style).
//
// Persists the full PaneNode tree to localStorage under `workspace:v1`.
// Splitting, closing, resizing, and focus changes flow through here so
// every pane stays in sync with the persistent tree.
// ─────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  newWorkspace,
  newPaneId,
  removeLeaf,
  replaceNode,
  resizeSplit,
  splitLeaf,
  defaultLeaf,
  findLeaf,
  type LeafConfig,
  type PaneNode,
  type SplitDirection,
  type Workspace,
} from '@/workspace/types';

interface WorkspaceStoreState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  // ── ops ──
  ensureActive: () => Workspace;
  setActive: (id: string) => void;
  createWorkspace: (name?: string) => Workspace;
  closeWorkspace: (id: string) => void;
  splitPane: (
    leafId: string,
    direction: SplitDirection,
    newLeafConfig?: Partial<LeafConfig>,
  ) => void;
  closePane: (leafId: string) => void;
  setFocus: (leafId: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  updateLeafConfig: (leafId: string, patch: Partial<LeafConfig>) => void;
  addShellPane: () => string;
  addAgentPane: (agent?: string) => string;
}

function updateActive(
  state: WorkspaceStoreState,
  fn: (w: Workspace) => Workspace,
): Pick<WorkspaceStoreState, 'workspaces'> {
  if (!state.activeWorkspaceId) return { workspaces: state.workspaces };
  return {
    workspaces: state.workspaces.map((w) =>
      w.id === state.activeWorkspaceId ? fn(w) : w,
    ),
  };
}

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,

      ensureActive: () => {
        const { workspaces, activeWorkspaceId } = get();
        if (activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId)) {
          return workspaces.find((w) => w.id === activeWorkspaceId)!;
        }
        const fresh = newWorkspace();
        set({ workspaces: [fresh], activeWorkspaceId: fresh.id });
        return fresh;
      },

      setActive: (id) => set({ activeWorkspaceId: id }),

      createWorkspace: (name) => {
        const fresh = newWorkspace(name);
        set((s) => ({
          workspaces: [...s.workspaces, fresh],
          activeWorkspaceId: fresh.id,
        }));
        return fresh;
      },

      closeWorkspace: (id) => set((s) => {
        const remaining = s.workspaces.filter((w) => w.id !== id);
        if (remaining.length === 0) {
          // Always keep at least one workspace alive.
          const fresh = newWorkspace();
          return { workspaces: [fresh], activeWorkspaceId: fresh.id };
        }
        const nextActive = s.activeWorkspaceId === id ? remaining[0].id : s.activeWorkspaceId;
        return { workspaces: remaining, activeWorkspaceId: nextActive };
      }),

      splitPane: (leafId, direction, newLeafConfig) => {
        const cfg: LeafConfig = {
          id: newPaneId(),
          kind: 'shell',
          label: 'Shell',
          ...newLeafConfig,
        };
        set((state) => updateActive(state, (w) => {
          const root = splitLeaf(w.root, leafId, direction, cfg);
          return { ...w, root, focusedPaneId: cfg.id };
        }));
      },

      closePane: (leafId) => set((state) => updateActive(state, (w) => {
        const root = removeLeaf(w.root, leafId);
        // If root collapsed to null, replace with a default leaf.
        const safeRoot: PaneNode = root ?? defaultLeaf('shell');
        return {
          ...w,
          root: safeRoot,
          focusedPaneId:
            w.focusedPaneId === leafId
              ? (root?.id ?? safeRoot.id)
              : w.focusedPaneId,
        };
      })),

      setFocus: (leafId) => set((state) => updateActive(state, (w) => ({
        ...w,
        focusedPaneId: leafId,
      }))),

      resizeSplit: (splitId, ratio) => set((state) => updateActive(state, (w) => ({
        ...w,
        root: resizeSplit(w.root, splitId, ratio),
      }))),

      updateLeafConfig: (leafId, patch) => set((state) => updateActive(state, (w) => ({
        ...w,
        root: replaceNode(w.root, leafId, {
          type: 'leaf',
          id: leafId,
          config: {
            ...(findLeaf(w.root, leafId)?.config ?? defaultLeaf().config),
            ...patch,
          },
        }),
      }))),

      addShellPane: () => {
        const id = newPaneId();
        set((state) => updateActive(state, (w) => ({
          ...w,
          root: splitLeaf(w.root, w.focusedPaneId, 'horizontal', {
            id,
            kind: 'shell',
            label: 'Shell',
          }),
          focusedPaneId: id,
        })));
        return id;
      },

      addAgentPane: (agent) => {
        const id = newPaneId();
        const cfg: LeafConfig = {
          id,
          kind: 'agent',
          label: agent ? `${agent}` : 'Agent',
          agent: (agent ?? 'claude') as LeafConfig['agent'],
        };
        set((state) => updateActive(state, (w) => ({
          ...w,
          root: splitLeaf(w.root, w.focusedPaneId, 'vertical', cfg),
          focusedPaneId: id,
        })));
        return id;
      },
    }),
    {
      name: 'workspace:v1',
      version: 1,
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    },
  ),
);