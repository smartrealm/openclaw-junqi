import type { OpenFileTab } from "./FileViewer";
import { rebaseOpenFileTabs, removeOpenFileTabs } from "./openFilePaths";

export interface FileViewerTabsState {
  tabs: OpenFileTab[];
  activePath: string | null;
}

export type FileViewerTabsAction =
  | { type: "open"; tab: OpenFileTab; preview?: boolean }
  | { type: "promote"; path: string }
  | { type: "select"; path: string }
  | { type: "close"; path: string }
  | { type: "close-others"; path: string }
  | { type: "close-right"; path: string }
  | { type: "close-left"; path: string }
  | { type: "close-all" }
  | { type: "rebase"; oldPath: string; newPath: string; isDirectory: boolean }
  | { type: "remove"; path: string; isDirectory: boolean }
  | { type: "reset" };

export const EMPTY_FILE_VIEWER_TABS: FileViewerTabsState = {
  tabs: [],
  activePath: null,
};

function activePathAfterRemoval(
  state: FileViewerTabsState,
  tabs: OpenFileTab[],
  removedIndex: number,
): string | null {
  if (state.activePath && tabs.some((tab) => tab.path === state.activePath)) {
    return state.activePath;
  }
  return tabs[Math.min(Math.max(removedIndex, 0), tabs.length - 1)]?.path ?? null;
}

export function reduceFileViewerTabs(
  state: FileViewerTabsState,
  action: FileViewerTabsAction,
): FileViewerTabsState {
  switch (action.type) {
    case "open": {
      const requestedPreview = action.preview ?? action.tab.isPreview ?? false;
      const existingIndex = state.tabs.findIndex((tab) => tab.path === action.tab.path);
      if (existingIndex !== -1) {
        const existing = state.tabs[existingIndex];
        const remainsPreview = requestedPreview && existing.isPreview === true;
        if (existing.name === action.tab.name && existing.isPreview === (remainsPreview ? true : undefined)) {
          return { ...state, activePath: action.tab.path };
        }
        const tabs = state.tabs.slice();
        tabs[existingIndex] = {
          ...existing,
          ...action.tab,
          isPreview: remainsPreview ? true : undefined,
        };
        return { tabs, activePath: action.tab.path };
      }

      const tab = { ...action.tab, isPreview: requestedPreview ? true : undefined };
      if (requestedPreview) {
        const previewIndex = state.tabs.findIndex((candidate) => candidate.isPreview === true);
        if (previewIndex !== -1) {
          const tabs = state.tabs.slice();
          tabs[previewIndex] = tab;
          return { tabs, activePath: tab.path };
        }
      }
      return { tabs: [...state.tabs, tab], activePath: tab.path };
    }
    case "promote": {
      const index = state.tabs.findIndex((tab) => tab.path === action.path);
      if (index === -1 || state.tabs[index]?.isPreview !== true) return state;
      const tabs = state.tabs.slice();
      tabs[index] = { ...tabs[index], isPreview: undefined };
      return { tabs, activePath: action.path };
    }
    case "select":
      return state.tabs.some((tab) => tab.path === action.path)
        ? { ...state, activePath: action.path }
        : state;
    case "close": {
      const index = state.tabs.findIndex((tab) => tab.path === action.path);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.path !== action.path);
      return { tabs, activePath: activePathAfterRemoval(state, tabs, index) };
    }
    case "close-others": {
      const tab = state.tabs.find((candidate) => candidate.path === action.path);
      return tab ? { tabs: [tab], activePath: tab.path } : state;
    }
    case "close-right": {
      const index = state.tabs.findIndex((tab) => tab.path === action.path);
      if (index === -1) return state;
      const tabs = state.tabs.slice(0, index + 1);
      return { tabs, activePath: activePathAfterRemoval(state, tabs, index) };
    }
    case "close-left": {
      const index = state.tabs.findIndex((tab) => tab.path === action.path);
      if (index === -1) return state;
      const tabs = state.tabs.slice(index);
      return { tabs, activePath: activePathAfterRemoval(state, tabs, 0) };
    }
    case "close-all":
    case "reset":
      return EMPTY_FILE_VIEWER_TABS;
    case "rebase": {
      const tabs = rebaseOpenFileTabs(
        state.tabs,
        action.oldPath,
        action.newPath,
        action.isDirectory,
      );
      const activeTabIndex = state.tabs.findIndex((tab) => tab.path === state.activePath);
      return {
        tabs,
        activePath: activeTabIndex === -1 ? state.activePath : tabs[activeTabIndex]?.path ?? null,
      };
    }
    case "remove": {
      const removedIndex = state.tabs.findIndex((tab) => tab.path === action.path);
      const tabs = removeOpenFileTabs(state.tabs, action.path, action.isDirectory);
      if (tabs.length === state.tabs.length) return state;
      return {
        tabs,
        activePath: activePathAfterRemoval(state, tabs, removedIndex),
      };
    }
  }
}
