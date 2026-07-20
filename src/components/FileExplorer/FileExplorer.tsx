// ═══════════════════════════════════════════════════════════
// FileExplorer — Virtualized file tree with context menus
// Ported from nezha with --aegis-* CSS var rewrites.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { RotateCcw, FolderOpen, ChevronsUpDown } from "lucide-react";
import { FileExplorerContextMenu } from "./ContextMenu";
import { CreateInputRow } from "./CreateInputRow";
import { TreeItem } from "./TreeItem";
import { writeClipboardText } from "./clipboard";
import { debugError } from "@/utils/debugLog";
import { subscribeTauriEvent } from "@/utils/tauriEvents";
import { dispatchFileTreePointerDrag } from "./pathDrag";
import {
  AUTO_REFRESH_MS,
  ROW_HEIGHT,
  type ContextMenuState,
  type CreateKind,
  type FsEntry,
  type TreeNode,
} from "./types";
import {
  findNode,
  flattenVisible,
  compactTreeNodes,
  joinPath,
  loadTreeNodes,
  parentPathOf,
  pathSeparator,
  updateNode,
} from "./treeUtils";

export function FileExplorer({
  projectPath,
  projectName,
  onFileSelect,
  active = true,
  width = 260,
}: {
  projectPath: string;
  projectName: string;
  onFileSelect: (path: string, name: string) => void;
  active?: boolean;
  width?: number;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [compactEmptyFolders, setCompactEmptyFolders] = useState(() =>
    localStorage.getItem("junqi.fileExplorer.compactEmptyFolders") === "true",
  );
  const [watcherFailed, setWatcherFailed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState<{
    parentPath: string;
    kind: CreateKind;
  } | null>(null);
  const [creatingValue, setCreatingValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commitInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickPathRef = useRef<string | null>(null);

  // ── Cancellable invoke wrapper ──
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const safeInvoke = useCallback(
    async <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> => {
      const result = await invoke<T>(cmd, args);
      if (cancelledRef.current) return null;
      return result;
    },
    [],
  );

  const isCancelled = useCallback(() => cancelledRef.current, []);

  // ── Context menu handlers ──
  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      path: node.path,
      isDir: node.is_dir,
      isRoot: false,
    });
  }, []);

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        path: projectPath,
        isDir: true,
        isRoot: true,
      });
    },
    [projectPath],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const openInSystemFolder = useCallback(
    async (event: React.MouseEvent, path: string) => {
      event.preventDefault();
      event.stopPropagation();
      setCtxMenu(null);
      try {
        await invoke("open_in_system_file_manager", { path, projectPath });
      } catch (error) {
        debugError("app", "Failed to open file in system folder", error);
        // Uses i18n key "file.failedOpenSystemFolder"
      }
    },
    [projectPath],
  );

  const copyPath = useCallback(
    async (event: React.MouseEvent, path: string, withAt: boolean) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await writeClipboardText(withAt ? `@${path}` : path);
      } catch (error) {
        debugError("app", "Failed to copy file path", error);
      } finally {
        setCtxMenu(null);
      }
    },
    [],
  );

  // ── Tree state ──
  const nodesRef = useRef<TreeNode[]>([]);
  const refreshIdRef = useRef(0);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const readEntries = useCallback(
    (path: string) => safeInvoke(compactEmptyFolders ? "read_compact_dir_entries" : "read_dir_entries", { path, projectPath }) as Promise<FsEntry[] | null>,
    [compactEmptyFolders, projectPath, safeInvoke],
  );

  useEffect(() => {
    localStorage.setItem("junqi.fileExplorer.compactEmptyFolders", String(compactEmptyFolders));
  }, [compactEmptyFolders]);

  const refresh = useCallback(
    async (showLoading = false) => {
      const refreshId = refreshIdRef.current + 1;
      refreshIdRef.current = refreshId;
      if (showLoading) setLoading(true);
      try {
        const nextNodes = await loadTreeNodes(projectPath, nodesRef.current, readEntries);
        if (nextNodes === null || refreshId !== refreshIdRef.current) return;
        if (nextNodes !== nodesRef.current) {
          setNodes(nextNodes);
        }
        setLoading(false);
      } catch {
        if (!isCancelled() && refreshId === refreshIdRef.current) {
          setLoading(false);
        }
      }
    },
    [isCancelled, projectPath, readEntries],
  );

  useEffect(() => {
    if (!active) return;
    void refresh(true);
  }, [active, projectPath, refresh]);

  const refreshDir = useCallback(async (dirPath: string) => {
    if (dirPath === projectPath) {
      await refresh();
      return;
    }
    const current = findNode(nodesRef.current, dirPath);
    if (!current?.expanded) return;
    const nextChildren = await loadTreeNodes(dirPath, current.children ?? [], readEntries);
    if (nextChildren === null) return;
    setNodes((previous) => updateNode(previous, dirPath, (node) => ({ ...node, children: nextChildren })));
  }, [projectPath, readEntries, refresh]);

  const watchedDirectories = useMemo(() => {
    const directories = [projectPath];
    const collect = (items: TreeNode[]) => {
      for (const node of items) {
        if (!node.is_dir || !node.expanded) continue;
        directories.push(node.path);
        if (node.children) collect(node.children);
      }
    };
    collect(nodes);
    return directories;
  }, [nodes, projectPath]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const registrations = watchedDirectories.map((path) =>
      invoke<boolean>("watch_dir", { path, projectPath }).then((available) => {
        if (!disposed && !available) setWatcherFailed(true);
      }).catch(() => {
        if (!disposed) setWatcherFailed(true);
      }),
    );
    return () => {
      disposed = true;
      for (let index = 0; index < watchedDirectories.length; index += 1) {
        const path = watchedDirectories[index];
        void registrations[index].then(() => invoke("unwatch_dir", { path })).catch(() => undefined);
      }
    };
  }, [active, projectPath, watchedDirectories]);

  useEffect(() => {
    if (!active) return;
    const unlisten = subscribeTauriEvent<{ dir: string }>("fs-changed", (event) => {
      void refreshDir(event.payload.dir);
    });
    return unlisten;
  }, [active, refreshDir]);

  // Auto-refresh timer
  useEffect(() => {
    if (!active || !watcherFailed) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    }, AUTO_REFRESH_MS);
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [active, refresh, watcherFailed]);

  useEffect(() => {
    if (!active || watcherFailed) return;
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [active, refresh, watcherFailed]);

  // ── Viewport measurement ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const displayNodes = useMemo(
    () => compactEmptyFolders ? compactTreeNodes(nodes) : nodes,
    [compactEmptyFolders, nodes],
  );
  const flat = useMemo(
    () => flattenVisible(displayNodes, projectPath, creating),
    [displayNodes, projectPath, creating],
  );

  const creatingPlacement = useMemo(() => {
    if (!creating) return null;
    const idx = flat.findIndex((r) => r.kind === "input");
    if (idx < 0) return null;
    const row = flat[idx];
    if (row.kind !== "input") return null;
    return { index: idx, depth: row.depth, kind: row.createKind };
  }, [flat, creating]);

  const OVERSCAN = 5;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(
    flat.length - 1,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  // ── Tree actions ──
  const handleToggle = useCallback(
    (dirPath: string) => {
      refreshIdRef.current += 1;
      const current = findNode(nodesRef.current, dirPath);
      const shouldExpand = !current?.expanded;

      setNodes((prev) =>
        updateNode(prev, dirPath, (node) => {
          const nextChildren = shouldExpand ? (node.children ?? []) : node.children;
          if (node.expanded === shouldExpand && node.children === nextChildren) {
            return node;
          }
          return { ...node, expanded: shouldExpand, children: nextChildren };
        }),
      );

      if (!shouldExpand) return;

      void (async () => {
        const currentChildren = findNode(nodesRef.current, dirPath)?.children ?? [];
        const nextChildren = await loadTreeNodes(dirPath, currentChildren, readEntries);
        if (nextChildren === null) return;
        setNodes((prev) =>
          updateNode(prev, dirPath, (node) =>
            node.children === nextChildren ? node : { ...node, children: nextChildren },
          ),
        );
      })();
    },
    [readEntries],
  );

  const handleSelect = useCallback(
    (node: TreeNode) => {
      if (suppressClickPathRef.current === node.path) return;
      setSelectedPath(node.path);
      onFileSelect(node.path, node.name);
    },
    [onFileSelect],
  );

  const handlePointerDown = useCallback((event: React.PointerEvent, node: TreeNode) => {
    if (event.button !== 0) return;
    dragCleanupRef.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleCancel, true);
      setDragPreview(null);
      dragCleanupRef.current = null;
    };
    const finish = (type: "drop" | "cancel", x: number, y: number) => {
      cleanup();
      if (!dragging) return;
      dispatchFileTreePointerDrag({ type, paths: [node.path], x, y });
      suppressClickPathRef.current = node.path;
      window.setTimeout(() => {
        if (suppressClickPathRef.current === node.path) suppressClickPathRef.current = null;
      }, 100);
    };
    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      dragging = true;
      moveEvent.preventDefault();
      setDragPreview({ x: moveEvent.clientX, y: moveEvent.clientY, node });
    }
    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      if (dragging) upEvent.preventDefault();
      finish("drop", upEvent.clientX, upEvent.clientY);
    }
    function handleCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return;
      finish("cancel", cancelEvent.clientX, cancelEvent.clientY);
    }
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleCancel, true);
  }, []);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const ensureExpanded = useCallback(
    (dirPath: string) => {
      if (dirPath === projectPath) return;
      const current = findNode(nodesRef.current, dirPath);
      if (!current?.expanded) {
        handleToggle(dirPath);
      }
    },
    [handleToggle, projectPath],
  );

  // ── Create file/folder ──
  const startCreate = useCallback(
    (kind: CreateKind) => {
      if (!ctxMenu) return;
      let parentPath: string;
      if (ctxMenu.isRoot) {
        parentPath = projectPath;
      } else if (ctxMenu.isDir) {
        parentPath = ctxMenu.path;
        ensureExpanded(parentPath);
      } else {
        parentPath = parentPathOf(ctxMenu.path);
      }
      setCtxMenu(null);
      setCreatingValue("");
      setCreating({ parentPath, kind });
    },
    [ctxMenu, ensureExpanded, projectPath],
  );

  const cancelCreate = useCallback(() => {
    setCreating(null);
    setCreatingValue("");
  }, []);

  const commitCreate = useCallback(async () => {
    if (!creating) return;
    if (commitInFlightRef.current) return;
    const name = creatingValue.trim();
    if (!name) {
      cancelCreate();
      return;
    }
    if (name.includes("/") || name.includes("\\")) {
      return;
    }
    commitInFlightRef.current = true;
    const fullPath = joinPath(creating.parentPath, name);
    const kind = creating.kind;
    const parentPath = creating.parentPath;
    try {
      if (kind === "file") {
        await safeInvoke("create_file", { path: fullPath, projectPath });
      } else {
        await safeInvoke("create_directory", { path: fullPath, projectPath });
      }
      if (isCancelled()) return;
      setCreating(null);
      setCreatingValue("");
      if (parentPath !== projectPath) {
        ensureExpanded(parentPath);
      }
      await refresh();
      if (isCancelled()) return;
      setSelectedPath(fullPath);
      if (kind === "file") {
        onFileSelect(fullPath, name);
      }
    } catch (error) {
      if (!isCancelled()) {
        debugError("app", "Failed to create:", error);
      }
    } finally {
      commitInFlightRef.current = false;
    }
  }, [
    cancelCreate,
    creating,
    creatingValue,
    ensureExpanded,
    isCancelled,
    onFileSelect,
    projectPath,
    refresh,
    safeInvoke,
  ]);

  // Scroll to create input when it appears
  useEffect(() => {
    if (!creating || !creatingPlacement) return;
    const el = scrollRef.current;
    if (!el) return;
    const rowTop = creatingPlacement.index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop || rowBottom > el.scrollTop + el.clientHeight) {
      const targetTop = Math.max(0, rowTop - el.clientHeight / 2 + ROW_HEIGHT);
      el.scrollTo({ top: targetTop, behavior: "auto" });
    }
  }, [creating, creatingPlacement]);

  // Focus input on create
  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [creating]);

  // ── Delete ──
  const handleDelete = useCallback(async () => {
    if (!ctxMenu || ctxMenu.isRoot) return;
    if (deleteInFlightRef.current) return;
    const targetPath = ctxMenu.path;
    const isDir = ctxMenu.isDir;
    const idx = Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\"));
    const name = idx >= 0 ? targetPath.slice(idx + 1) : targetPath;
    setCtxMenu(null);

    const ok = await confirm(
      isDir
        ? t("file.confirmDeleteFolder", { name })
        : t("file.confirmDeleteFile", { name }),
      {
        title: t("file.confirmDeleteTitle", { name }),
        kind: "warning",
        okLabel: t("file.delete"),
      },
    );
    if (!ok) return;

    deleteInFlightRef.current = true;
    try {
      await safeInvoke("delete_path", { path: targetPath, projectPath });
      if (isCancelled()) return;
      const sep = pathSeparator(targetPath);
      const descendantPrefix = targetPath + sep;
      setSelectedPath((prev) => {
        if (!prev) return prev;
        if (prev === targetPath) return null;
        if (prev.startsWith(descendantPrefix)) return null;
        return prev;
      });
      await refresh();
    } catch (error) {
      if (!isCancelled()) {
        debugError("app", "Failed to delete:", error);
      }
    } finally {
      deleteInFlightRef.current = false;
    }
  }, [ctxMenu, isCancelled, projectPath, refresh, safeInvoke, t]);

  // ── Render ──
  return (
    <div
      style={{
        flexShrink: 0,
        width,
        background: "var(--aegis-surface)",
        borderLeft: "1px solid var(--aegis-border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {dragPreview && (
        <div
          className="pointer-events-none fixed z-[10000] flex max-w-64 items-center gap-2 rounded border border-aegis-border bg-aegis-surface px-2 py-1 text-xs text-aegis-text shadow-lg"
          style={{ left: dragPreview.x + 12, top: dragPreview.y + 12 }}
        >
          {dragPreview.node.is_dir ? <FolderOpen size={13} /> : <span className="text-aegis-primary">@</span>}
          <span className="truncate">{dragPreview.node.name}</span>
        </div>
      )}
      {ctxMenu && (
        <FileExplorerContextMenu
          ctxMenu={ctxMenu}
          onClose={closeCtxMenu}
          onNewFile={() => startCreate("file")}
          onNewFolder={() => startCreate("folder")}
          onDelete={() => void handleDelete()}
          onOpenInSystem={(event, path) => void openInSystemFolder(event, path)}
          onCopyPath={(event, path, withAt) => void copyPath(event, path, withAt)}
        />
      )}

      {/* Header */}
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--aegis-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--aegis-text-dim)",
            letterSpacing: 0.7,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {t("file.files", "Files")}
        </span>
        <button
          type="button"
          onClick={() => setCompactEmptyFolders((value) => !value)}
          title={t("file.compactEmptyFolders", "Compact single-folder chains")}
          aria-pressed={compactEmptyFolders}
          style={{
            background: compactEmptyFolders ? "var(--aegis-hover)" : "none",
            border: "none",
            cursor: "pointer",
            color: compactEmptyFolders ? "var(--aegis-primary)" : "var(--aegis-text-dim)",
            padding: 4,
            borderRadius: 4,
            display: "flex",
          }}
        >
          <ChevronsUpDown size={13} />
        </button>
        <button
          onClick={() => void refresh()}
          title={t("common.refresh", "Refresh")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--aegis-text-dim)",
            padding: 4,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--aegis-text)";
            e.currentTarget.style.background = "var(--aegis-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--aegis-text-dim)";
            e.currentTarget.style.background = "none";
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Project root label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px 3px 20px",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--aegis-text)",
        }}
      >
        <span
          style={{
            width: 5,
            height: 14,
            borderRadius: 2,
            background: "var(--aegis-primary)",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        {projectName}
      </div>

      {/* Tree */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onContextMenu={handleEmptyContextMenu}
        style={{
          flex: 1,
          overflowY: "auto",
          position: "relative",
        }}
      >
        {loading ? (
          <div
            onContextMenu={handleEmptyContextMenu}
            style={{
              padding: "16px 12px",
              fontSize: 12,
              color: "var(--aegis-text-dim)",
              textAlign: "center",
            }}
          >
            {t("common.loading", "Loading...")}
          </div>
        ) : flat.length === 0 ? (
          <div
            onContextMenu={handleEmptyContextMenu}
            style={{
              padding: "16px 12px",
              fontSize: 12,
              color: "var(--aegis-text-dim)",
              textAlign: "center",
            }}
          >
            {t("file.emptyDirectory", "Empty directory")}
          </div>
        ) : (
          <div
            style={{ position: "relative", height: flat.length * ROW_HEIGHT + 12 }}
            onContextMenu={handleEmptyContextMenu}
          >
            {flat.slice(startIdx, endIdx + 1).map((row, i) => {
              if (row.kind === "input") return null;
              const top = (startIdx + i) * ROW_HEIGHT + 2;
              return (
                <div
                  key={row.node.path}
                  style={{ position: "absolute", width: "100%", top }}
                >
                  <TreeItem
                    node={row.node}
                    depth={row.depth}
                    selectedPath={selectedPath}
                    contextPath={ctxMenu?.path ?? null}
                    onSelect={handleSelect}
                    onToggle={handleToggle}
                    onContextMenu={handleContextMenu}
                    onPointerDown={handlePointerDown}
                    draggingPath={dragPreview?.node.path ?? null}
                  />
                </div>
              );
            })}
            {creating && creatingPlacement && (
              <div
                key="__create_row__"
                style={{
                  position: "absolute",
                  width: "100%",
                  top: creatingPlacement.index * ROW_HEIGHT + 2,
                }}
              >
                <CreateInputRow
                  depth={creatingPlacement.depth}
                  kind={creatingPlacement.kind}
                  value={creatingValue}
                  onChange={setCreatingValue}
                  onCommit={() => {
                    void commitCreate();
                  }}
                  onCancel={cancelCreate}
                  inputRef={inputRef}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
