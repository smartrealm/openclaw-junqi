import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { FileNameDialog, type FileNameDialogRequest } from "./FileNameDialog";
import { writeClipboardText } from "./clipboard";
import { joinPath, parentPathOf } from "./treeUtils";
import type { ContextMenuState, CreateKind } from "./types";

type PendingNameAction = FileNameDialogRequest & {
  path: string;
  isDir: boolean;
};

export interface FileExplorerContextActionsOptions {
  projectPath: string;
  onOpenFile: (path: string, name: string) => void;
  onRefresh: () => void | Promise<void>;
  onBeforePathMutation?: (path: string, isDirectory: boolean) => void | Promise<void>;
  onPathRenamed?: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  onPathDeleted?: (path: string, isDirectory: boolean) => void;
  onRevealPath?: (path: string) => Promise<void>;
  onError?: (error: unknown) => void;
}

function nameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

export function useFileExplorerContextActions({
  projectPath,
  onOpenFile,
  onRefresh,
  onBeforePathMutation,
  onPathRenamed,
  onPathDeleted,
  onRevealPath,
  onError,
}: FileExplorerContextActionsOptions) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingNameAction, setPendingNameAction] = useState<PendingNameAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const operationIdRef = useRef(0);

  const reportError = useCallback((error: unknown) => {
    setActionError(error instanceof Error ? error.message : String(error));
    onError?.(error);
  }, [onError]);

  const openContextMenu = useCallback((target: Omit<ContextMenuState, "x" | "y">, x: number, y: number) => {
    setActionError(null);
    setContextMenu({ ...target, x, y });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openSelectedFile = useCallback(() => {
    if (!contextMenu || contextMenu.isRoot || contextMenu.isDir) return;
    const { path } = contextMenu;
    setContextMenu(null);
    onOpenFile(path, nameOf(path));
  }, [contextMenu, onOpenFile]);

  const startCreate = useCallback((kind: CreateKind) => {
    if (!contextMenu) return;
    const path = contextMenu.isRoot || contextMenu.isDir
      ? contextMenu.path
      : parentPathOf(contextMenu.path);
    setContextMenu(null);
    setActionError(null);
    setPendingNameAction({
      mode: kind === "file" ? "new-file" : "new-folder",
      initialValue: "",
      path,
      isDir: kind === "folder",
    });
  }, [contextMenu]);

  const startRename = useCallback(() => {
    if (!contextMenu || contextMenu.isRoot) return;
    setActionError(null);
    setPendingNameAction({
      mode: "rename",
      initialValue: nameOf(contextMenu.path),
      path: contextMenu.path,
      isDir: contextMenu.isDir,
    });
    setContextMenu(null);
  }, [contextMenu]);

  const cancelNameAction = useCallback(() => {
    if (busy) return;
    operationIdRef.current += 1;
    setPendingNameAction(null);
    setActionError(null);
  }, [busy]);

  const submitNameAction = useCallback(async (newName: string) => {
    const action = pendingNameAction;
    if (!action || busy) return;
    const operationId = ++operationIdRef.current;
    setBusy(true);
    setActionError(null);
    try {
      if (action.mode === "rename") {
        if (newName === action.initialValue) {
          setPendingNameAction(null);
          return;
        }
        await onBeforePathMutation?.(action.path, action.isDir);
        const newPath = await invoke<string>("rename_path", {
          path: action.path,
          newName,
          projectPath,
        });
        if (operationId !== operationIdRef.current) return;
        onPathRenamed?.(action.path, newPath, action.isDir);
      } else {
        const newPath = joinPath(action.path, newName);
        await invoke(action.mode === "new-file" ? "create_file" : "create_directory", {
          path: newPath,
          projectPath,
        });
        if (operationId !== operationIdRef.current) return;
        if (action.mode === "new-file") onOpenFile(newPath, newName);
      }
      setPendingNameAction(null);
      await onRefresh();
    } catch (error) {
      if (operationId === operationIdRef.current) reportError(error);
    } finally {
      if (operationId === operationIdRef.current) setBusy(false);
    }
  }, [busy, onBeforePathMutation, onOpenFile, onPathRenamed, onRefresh, pendingNameAction, projectPath, reportError]);

  const deleteSelectedPath = useCallback(async () => {
    if (!contextMenu || contextMenu.isRoot || busy) return;
    const { path, isDir } = contextMenu;
    const name = nameOf(path);
    setContextMenu(null);
    try {
      const confirmed = await confirm(
        isDir
          ? t("file.confirmDeleteFolder", { name })
          : t("file.confirmDeleteFile", { name }),
        {
          title: t("file.confirmDeleteTitle", { name }),
          kind: "warning",
          okLabel: t("file.delete", "Delete"),
        },
      );
      if (!confirmed) return;
      const operationId = ++operationIdRef.current;
      setBusy(true);
      setActionError(null);
      await onBeforePathMutation?.(path, isDir);
      await invoke("delete_path", { path, projectPath });
      if (operationId !== operationIdRef.current) return;
      onPathDeleted?.(path, isDir);
      await onRefresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [busy, contextMenu, onBeforePathMutation, onPathDeleted, onRefresh, projectPath, reportError, t]);

  const copySelectedPath = useCallback(async (path: string, withAt: boolean) => {
    setContextMenu(null);
    try {
      await writeClipboardText(withAt ? `@${path}` : path);
    } catch (error) {
      reportError(error);
    }
  }, [reportError]);

  const revealSelectedPath = useCallback(async (path: string) => {
    setContextMenu(null);
    try {
      if (onRevealPath) await onRevealPath(path);
      else await invoke("open_in_system_file_manager", { path, projectPath });
    } catch (error) {
      reportError(error);
    }
  }, [onRevealPath, projectPath, reportError]);

  const nameDialog = useMemo(() => pendingNameAction ? (
    <FileNameDialog
      request={pendingNameAction}
      busy={busy}
      error={actionError}
      onCancel={cancelNameAction}
      onSubmit={(name) => void submitNameAction(name)}
    />
  ) : null, [actionError, busy, cancelNameAction, pendingNameAction, submitNameAction]);

  return {
    actionError,
    clearActionError: () => setActionError(null),
    contextMenu,
    openContextMenu,
    closeContextMenu,
    openSelectedFile,
    startCreate,
    startRename,
    deleteSelectedPath,
    copySelectedPath,
    revealSelectedPath,
    nameDialog,
  };
}
