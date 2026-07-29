/**
 * Agent workspace panel. The tree owns workspace navigation while the shared
 * FileViewer owns file loading, editing, previews, tabs, and disk sync.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronLeft, FolderOpen, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  FileViewer,
  type FileViewerHandle,
  type ThemeVariant,
} from "@/components/FileExplorer/FileViewer";
import {
  EMPTY_FILE_VIEWER_TABS,
  reduceFileViewerTabs,
} from "@/components/FileExplorer/fileViewerTabsState";
import { useChatStore } from "@/stores/chatStore";
import { useGatewayDataStore } from "@/stores/gatewayDataStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { getWorkspacePath, type FsEntry } from "@/services/workspaceFs";
import { useTheme } from "@/theme/useTheme";
import { WorkspaceFileTree } from "./WorkspaceFileTree";

interface WorkspacePanelProps {
  onClose?: () => void;
  agentId?: string;
  rootOverride?: string;
}

interface PendingRootSwitch {
  root: string | null;
  failed: boolean;
}

export function WorkspacePanel({ onClose, agentId: agentIdProp, rootOverride }: WorkspacePanelProps) {
  const { t } = useTranslation();
  const activeKey = useChatStore((state) => state.activeSessionKey);
  const agents = useGatewayDataStore((state) => state.agents);
  const addToast = useNotificationStore((state) => state.addToast);
  const resolvedTheme = useTheme();
  const themeVariant = resolvedTheme.replace("aegis-", "") as ThemeVariant;
  const [root, setRoot] = useState<string | null>(null);
  const [rootError, setRootError] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const [closing, setClosing] = useState(false);
  const [pendingRootSwitch, setPendingRootSwitch] = useState<PendingRootSwitch | null>(null);
  const [files, dispatchFiles] = useReducer(reduceFileViewerTabs, EMPTY_FILE_VIEWER_TABS);
  const rootRef = useRef<string | null>(null);
  const rootSwitchRequestRef = useRef(0);
  const fileViewerRef = useRef<FileViewerHandle>(null);

  const agentId = useMemo(
    () => agentIdProp || activeKey?.split(":")[1] || "main",
    [activeKey, agentIdProp],
  );
  const agentWorkspace = useMemo(
    () => agents.find((candidate) => candidate.id === agentId)?.workspace,
    [agentId, agents],
  );

  const switchRoot = useCallback(async (target: PendingRootSwitch) => {
    const requestId = ++rootSwitchRequestRef.current;
    if (rootRef.current === target.root) {
      setRootError(target.failed);
      setPendingRootSwitch(null);
      return;
    }
    try {
      if (rootRef.current) {
        await fileViewerRef.current?.flushPath(rootRef.current, true);
      }
    } catch (error) {
      if (requestId !== rootSwitchRequestRef.current) return;
      setPendingRootSwitch(target);
      addToast(
        "error",
        t("workspace.saveFailed", "Save failed"),
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (requestId !== rootSwitchRequestRef.current) return;

    rootRef.current = target.root;
    setRoot(target.root);
    setRootError(target.failed);
    setPendingRootSwitch(null);
    dispatchFiles({ type: "reset" });
  }, [addToast, t]);

  useEffect(() => {
    let cancelled = false;

    const resolveRoot = async () => {
      let nextRoot: string | null = null;
      let failed = false;
      try {
        nextRoot = rootOverride || agentWorkspace || await getWorkspacePath();
      } catch {
        failed = true;
      }
      if (cancelled) return;
      await switchRoot({ root: nextRoot, failed });
    };

    void resolveRoot();
    return () => {
      cancelled = true;
      rootSwitchRequestRef.current += 1;
    };
  }, [agentWorkspace, rootOverride, switchRoot]);

  const openFile = useCallback((entry: FsEntry) => {
    dispatchFiles({
      type: "open",
      tab: { path: entry.path, name: entry.name },
    });
  }, []);

  const handleBeforePathMutation = useCallback(
    (path: string, isDirectory: boolean) => (
      fileViewerRef.current?.flushPath(path, isDirectory) ?? Promise.resolve()
    ),
    [],
  );

  const handlePathRenamed = useCallback((oldPath: string, newPath: string, isDirectory: boolean) => {
    dispatchFiles({ type: "rebase", oldPath, newPath, isDirectory });
  }, []);

  const handlePathDeleted = useCallback((path: string, isDirectory: boolean) => {
    dispatchFiles({ type: "remove", path, isDirectory });
  }, []);

  const requestClose = useCallback(async () => {
    if (!onClose || closing) return;
    setClosing(true);
    try {
      if (rootRef.current) {
        await fileViewerRef.current?.flushPath(rootRef.current, true);
      }
      onClose();
    } catch (error) {
      addToast(
        "error",
        t("workspace.saveFailed", "Save failed"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setClosing(false);
    }
  }, [addToast, closing, onClose, t]);

  const workspaceName = root
    ? root.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || root
    : "";

  return (
    <div className="flex h-full min-h-0 w-full bg-aegis-bg-frosted-60">
      <aside className="flex w-[clamp(210px,24%,300px)] shrink-0 flex-col border-e border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)]">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3">
          <FolderOpen size={14} className="shrink-0 text-aegis-primary" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-aegis-text" title={root || ""}>
            {workspaceName || t("workspace.title", "Workspace")}
          </span>
          <button
            type="button"
            onClick={() => setTreeKey((key) => key + 1)}
            title={t("common.refresh", "Refresh")}
            className="rounded p-1 text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary"
          >
            <RefreshCw size={13} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={() => void requestClose()}
              disabled={closing}
              title={t("workspace.collapse", "Collapse workspace")}
              className="rounded p-1 text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary"
            >
              <ChevronLeft size={15} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1">
          {pendingRootSwitch && (
            <div className="m-1.5 rounded border border-aegis-warning/30 bg-aegis-warning/10 px-2 py-2 text-[10px] text-aegis-text-secondary">
              <p>{t("workspace.switchPending", "Resolve the unsaved file, then retry switching workspaces.")}</p>
              <button
                type="button"
                onClick={() => void switchRoot(pendingRootSwitch)}
                className="mt-1 font-semibold text-aegis-primary hover:underline"
              >
                {t("common.retry", "Retry")}
              </button>
            </div>
          )}
          {rootError || !root ? (
            <div className="p-4 text-center text-[11px] text-aegis-text-dim">
              {t("workspace.locateFailed", "Unable to locate this agent's workspace directory")}
            </div>
          ) : (
            <WorkspaceFileTree
              key={`${root}:${treeKey}`}
              root={root}
              activePath={files.activePath}
              onOpenFile={openFile}
              onBeforePathMutation={handleBeforePathMutation}
              onPathRenamed={handlePathRenamed}
              onPathDeleted={handlePathDeleted}
            />
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-aegis-bg">
        {root && files.tabs.length > 0 && files.activePath ? (
          <FileViewer
            ref={fileViewerRef}
            tabs={files.tabs}
            activeFilePath={files.activePath}
            projectPath={root}
            themeVariant={themeVariant}
            onSelectTab={(path) => dispatchFiles({ type: "select", path })}
            onCloseTab={(path) => dispatchFiles({ type: "close", path })}
            onCloseOtherTabs={(path) => dispatchFiles({ type: "close-others", path })}
            onCloseTabsToRight={(path) => dispatchFiles({ type: "close-right", path })}
            onCloseTabsToLeft={(path) => dispatchFiles({ type: "close-left", path })}
            onCloseAllTabs={() => dispatchFiles({ type: "close-all" })}
            onFileMissing={(path) => dispatchFiles({ type: "close", path })}
            onOpenFile={(path, name) => dispatchFiles({ type: "open", tab: { path, name } })}
          />
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3 text-[11px] text-aegis-text-dim">
              {t("workspace.selectFile", "Select a file to edit or preview")}
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
              <div>
                <FolderOpen size={30} className="mx-auto mb-3 text-aegis-text-dim opacity-30" />
                <p className="text-[12px] font-medium text-aegis-text-muted">
                  {t("workspace.selectFile", "Select a file to edit or preview")}
                </p>
                <p className="mt-1 text-[10px] text-aegis-text-dim">{workspaceName}</p>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
