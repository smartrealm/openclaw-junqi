import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { showAlert } from "@/components/shared/alertStore";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  checkpointLocalEditorDocuments,
  deleteLocalEditorDocument,
  releaseLocalEditorDocuments,
} from "@/workspace-files/services/localEditorDocuments";
import { FilePreviewPane } from "./FilePreviewPane";
import { FileViewerTabBar } from "./FileViewerTabBar";
import { FileViewerToolbar } from "./FileViewerToolbar";
import { resolveFileViewerPreview } from "./fileViewerCapabilities";
import { workspaceRelativePath, type FileViewMode } from "./fileViewerModel";
import { pathIsTargetOrDescendant } from "./openFilePaths";
import { runAfterSaveBarrier } from "./saveBeforeTransition";
import type { FileViewerHandle, FileViewerProps } from "./fileViewerTypes";

export type { FileViewerHandle, FileViewerProps, OpenFileTab, ThemeVariant } from "./fileViewerTypes";

export const FileViewer = forwardRef<FileViewerHandle, FileViewerProps>(function FileViewer({
  tabs,
  activeFilePath,
  projectPath,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onCloseAllTabs,
  themeVariant = "dark",
  onRunMakeTarget,
  onFileMissing,
  onDirtyChange,
  onOpenFile = () => undefined,
  hideTabBar = false,
  documentOwnerPrefix = "file-viewer",
}, ref) {
  const { t } = useTranslation();
  const addToast = useNotificationStore((state) => state.addToast);
  const closeInFlightRef = useRef(false);
  const [previewModes, setPreviewModes] = useState<Record<string, boolean>>({});
  const [tableOfContentsModes, setTableOfContentsModes] = useState<Record<string, boolean>>({});
  const [tableOfContentsAvailability, setTableOfContentsAvailability] = useState<Record<string, boolean>>({});
  const [wordWrap, setWordWrap] = useState(true);

  const leaseForPath = useCallback((path: string) => ({
    rootPath: projectPath,
    path,
    ownerId: `${documentOwnerPrefix}:${path}`,
  }), [documentOwnerPrefix, projectPath]);

  const flushPath = useCallback(async (path: string, isDirectory: boolean) => {
    await checkpointLocalEditorDocuments(
      tabs
        .filter((tab) => pathIsTargetOrDescendant(tab.path, path, isDirectory))
        .map((tab) => leaseForPath(tab.path)),
    );
  }, [leaseForPath, tabs]);

  useImperativeHandle(ref, () => ({ flushPath }), [flushPath]);

  useEffect(() => {
    const openPaths = new Set(tabs.map((tab) => tab.path));
    const keepOpenPaths = (current: Record<string, boolean>) => Object.fromEntries(
      Object.entries(current).filter(([path]) => openPaths.has(path)),
    );
    setPreviewModes(keepOpenPaths);
    setTableOfContentsModes(keepOpenPaths);
    setTableOfContentsAvailability(keepOpenPaths);
  }, [tabs]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activeFilePath) ?? tabs[tabs.length - 1] ?? null,
    [activeFilePath, tabs],
  );

  const closeTabsAfterSave = useCallback((paths: string[], commit: () => void) => {
    if (closeInFlightRef.current || paths.length === 0) return;
    closeInFlightRef.current = true;
    void runAfterSaveBarrier(
      () => releaseLocalEditorDocuments(paths.map(leaseForPath)),
      commit,
    ).catch((reason) => {
      showAlert(
        t("file.closeFailed", "Could not close file"),
        reason instanceof Error ? reason.message : String(reason),
        "error",
      );
    }).finally(() => {
      closeInFlightRef.current = false;
    });
  }, [leaseForPath, t]);

  const copyPath = useCallback((path: string) => {
    if (!navigator.clipboard?.writeText) {
      addToast("error", t("file.copyPathFailed", "Unable to copy path"), path);
      return;
    }
    void navigator.clipboard.writeText(path).then(
      () => addToast("info", t("file.pathCopied", "Path copied"), path),
      () => addToast("error", t("file.copyPathFailed", "Unable to copy path"), path),
    );
  }, [addToast, t]);

  const revealPath = useCallback((path: string) => {
    void invoke("open_in_system_file_manager", { path, projectPath }).catch(() => {
      addToast("error", t("file.revealFailed", "Unable to reveal file"), path);
    });
  }, [addToast, projectPath, t]);

  const updateTableOfContentsAvailability = useCallback((path: string, available: boolean) => {
    setTableOfContentsAvailability((current) => current[path] === available
      ? current
      : { ...current, [path]: available });
  }, []);

  const removeMissingFile = useCallback((path: string) => {
    void deleteLocalEditorDocument(projectPath, path, `${documentOwnerPrefix}:${path}`)
      .then(() => onFileMissing?.(path));
  }, [documentOwnerPrefix, onFileMissing, projectPath]);

  if (!activeTab) return null;

  const activeIsMarkdown = resolveFileViewerPreview(activeTab.name).mode === "markdown";
  const activePreviewMode = activeIsMarkdown && (previewModes[activeTab.path] ?? true);
  const activeViewMode: FileViewMode = activePreviewMode ? "preview" : "source";
  const activeTableOfContentsVisible = activePreviewMode && (tableOfContentsModes[activeTab.path] ?? false);
  const activeTableOfContentsAvailable = tableOfContentsAvailability[activeTab.path] ?? false;
  const activeRelativePath = workspaceRelativePath(activeTab.path, projectPath);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0, background: "var(--aegis-elevated)" }}>
      {!hideTabBar ? (
        <FileViewerTabBar
          tabs={tabs}
          activePath={activeTab.path}
          onSelect={onSelectTab}
          onClosePaths={closeTabsAfterSave}
          onCloseTab={onCloseTab}
          onCloseOtherTabs={onCloseOtherTabs}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseAllTabs={onCloseAllTabs}
        />
      ) : null}
      <FileViewerToolbar
        relativePath={activeRelativePath}
        isMarkdown={activeIsMarkdown}
        viewMode={activeViewMode}
        tableOfContentsVisible={activeTableOfContentsVisible}
        tableOfContentsAvailable={activeTableOfContentsAvailable}
        wordWrap={wordWrap}
        onViewModeChange={(mode) => setPreviewModes((current) => ({ ...current, [activeTab.path]: mode === "preview" }))}
        onToggleTableOfContents={() => setTableOfContentsModes((current) => ({ ...current, [activeTab.path]: !(current[activeTab.path] ?? false) }))}
        onToggleWordWrap={() => setWordWrap((current) => !current)}
        onCopyPath={() => copyPath(activeTab.path)}
        onCopyRelativePath={() => copyPath(activeRelativePath)}
        onReveal={() => revealPath(activeTab.path)}
      />
      <div style={{ flex: 1, position: "relative", minWidth: 0, minHeight: 0 }}>
        {tabs.map((tab) => {
          const active = tab.path === activeTab.path;
          return (
            <div
              key={tab.path}
              aria-hidden={!active}
              style={{ position: "absolute", inset: 0, display: "flex", visibility: active ? "visible" : "hidden", pointerEvents: active ? "auto" : "none" }}
            >
              <FilePreviewPane
                filePath={tab.path}
                fileName={tab.name}
                projectPath={projectPath}
                ownerId={`${documentOwnerPrefix}:${tab.path}`}
                themeVariant={themeVariant}
                active={active}
                previewMode={resolveFileViewerPreview(tab.name).mode === "markdown" && (previewModes[tab.path] ?? true)}
                tableOfContentsVisible={tableOfContentsModes[tab.path] ?? false}
                wordWrap={wordWrap}
                onRunMakeTarget={onRunMakeTarget}
                onDirtyChange={onDirtyChange}
                onOpenFile={onOpenFile}
                onFileMissing={removeMissingFile}
                onCloseTableOfContents={() => setTableOfContentsModes((current) => ({ ...current, [tab.path]: false }))}
                onTableOfContentsAvailabilityChange={updateTableOfContentsAvailability}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
