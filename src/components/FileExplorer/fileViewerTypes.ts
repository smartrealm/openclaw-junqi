export interface OpenFileTab {
  path: string;
  name: string;
  /** Temporary tabs are replaced by the next preview in the same workspace scope. */
  isPreview?: boolean;
}

export interface FileViewerHandle {
  flushPath: (path: string, isDirectory: boolean) => Promise<void>;
}

export type ThemeVariant = "dark" | "midnight" | "light" | "eyecare";

export interface FileViewerProps {
  tabs: OpenFileTab[];
  activeFilePath: string | null;
  projectPath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseOtherTabs: (path: string) => void;
  onCloseTabsToRight: (path: string) => void;
  onCloseTabsToLeft: (path: string) => void;
  onCloseAllTabs: () => void;
  themeVariant?: ThemeVariant;
  onRunMakeTarget?: (target: string) => void;
  onFileMissing?: (path: string) => void;
  onDirtyChange?: (path: string, dirty: boolean) => void;
  onOpenFile?: (path: string, name: string) => void;
  hideTabBar?: boolean;
  documentOwnerPrefix?: string;
}
