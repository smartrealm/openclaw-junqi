import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { FileExplorerContextMenu } from '@/components/FileExplorer/ContextMenu';
import { useFileExplorerContextActions } from '@/components/FileExplorer/useFileExplorerContextActions';
import { readDir, type FsEntry } from '@/services/workspaceFs';

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : null;
}

function TreeNode({
  entry,
  root,
  depth,
  activePath,
  refreshVersion,
  onOpenFile,
  onEntryContextMenu,
}: {
  entry: FsEntry;
  root: string;
  depth: number;
  activePath: string | null;
  refreshVersion: number;
  onOpenFile: (entry: FsEntry) => void;
  onEntryContextMenu: (event: MouseEvent, entry: FsEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const lastRefreshVersionRef = useRef(refreshVersion);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(false);
    try {
      setChildren(await readDir(entry.path, root));
    } catch {
      setErr(true);
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [entry.path, root]);

  useEffect(() => {
    if (lastRefreshVersionRef.current === refreshVersion) return;
    lastRefreshVersionRef.current = refreshVersion;
    if (open) void load();
  }, [load, open, refreshVersion]);

  const toggle = async () => {
    if (!entry.is_dir) {
      onOpenFile(entry);
      return;
    }
    if (!open && children === null) await load();
    setOpen((current) => !current);
  };

  const active = activePath === entry.path;
  return (
    <div>
      <button
        type="button"
        data-file-tree-entry="true"
        onClick={() => void toggle()}
        onContextMenu={(event) => onEntryContextMenu(event, entry)}
        title={entry.name}
        className={[
          'flex w-full items-center gap-1 rounded py-[3px] pe-2 text-start text-[12px] transition-colors',
          active
            ? 'bg-aegis-primary/15 text-aegis-primary'
            : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text',
          entry.is_gitignored ? 'opacity-45' : '',
        ].join(' ')}
        style={{ paddingInlineStart: 6 + depth * 12 }}
      >
        {entry.is_dir ? (
          loading
            ? <Loader2 size={13} className="shrink-0 animate-spin" />
            : open
              ? <ChevronDown size={13} className="shrink-0" />
              : <ChevronRight size={13} className="shrink-0" />
        ) : <span className="w-[13px] shrink-0" />}
        {entry.is_dir
          ? open
            ? <FolderOpen size={13} className="shrink-0 text-aegis-primary/70" />
            : <Folder size={13} className="shrink-0 text-aegis-primary/70" />
          : <File size={13} className="shrink-0 text-aegis-text-dim" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && children?.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          root={root}
          depth={depth + 1}
          activePath={activePath}
          refreshVersion={refreshVersion}
          onOpenFile={onOpenFile}
          onEntryContextMenu={onEntryContextMenu}
        />
      ))}
      {open && err && (
        <div className="text-[10px] text-aegis-danger/70" style={{ paddingInlineStart: 6 + (depth + 1) * 12 }}>
          读取失败
        </div>
      )}
    </div>
  );
}

export function WorkspaceFileTree({
  root,
  activePath,
  onOpenFile,
  onBeforePathMutation,
  onPathRenamed,
  onPathDeleted,
}: {
  root: string;
  activePath: string | null;
  onOpenFile: (entry: FsEntry) => void;
  onBeforePathMutation?: (path: string, isDirectory: boolean) => Promise<void>;
  onPathRenamed?: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  onPathDeleted?: (path: string, isDirectory: boolean) => void;
}) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setEntries(await readDir(root, root));
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAfterMutation = useCallback(async () => {
    await load();
    setTreeVersion((version) => version + 1);
  }, [load]);

  const actions = useFileExplorerContextActions({
    projectPath: root,
    onOpenFile: (path, name) => onOpenFile({
      name,
      path,
      is_dir: false,
      extension: extensionOf(name),
    }),
    onRefresh: refreshAfterMutation,
    onBeforePathMutation,
    onPathRenamed,
    onPathDeleted,
  });

  const openEntryContextMenu = useCallback((event: MouseEvent, entry: FsEntry) => {
    event.preventDefault();
    event.stopPropagation();
    actions.openContextMenu(
      { path: entry.path, isDir: entry.is_dir, isRoot: false },
      event.clientX,
      event.clientY,
    );
  }, [actions]);

  const content = loading && entries === null ? (
    <div className="flex items-center justify-center py-8 text-aegis-text-dim">
      <Loader2 size={16} className="animate-spin" />
    </div>
  ) : err ? (
    <div className="p-3 text-center">
      <p className="mb-2 break-words text-[11px] text-aegis-danger/80">{err}</p>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-[11px] text-aegis-text-muted hover:text-aegis-text">
        <RefreshCw size={11} /> 重试
      </button>
    </div>
  ) : !entries || entries.length === 0 ? (
    <div className="p-4 text-center text-[11px] text-aegis-text-dim">工作区为空</div>
  ) : (
    <div className="py-1">
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          root={root}
          depth={0}
          activePath={activePath}
          refreshVersion={treeVersion}
          onOpenFile={onOpenFile}
          onEntryContextMenu={openEntryContextMenu}
        />
      ))}
    </div>
  );

  return (
    <div
      className="min-h-full"
      onContextMenuCapture={(event) => {
        if ((event.target as HTMLElement).closest('[data-file-tree-entry="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        actions.openContextMenu({ path: root, isDir: true, isRoot: true }, event.clientX, event.clientY);
      }}
    >
      {actions.actionError && (
        <div className="mx-1.5 mt-1.5 flex items-start gap-1.5 rounded border border-aegis-danger/25 bg-aegis-danger/10 px-2 py-1.5 text-[10px] text-aegis-danger">
          <AlertCircle size={11} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{actions.actionError}</span>
        </div>
      )}
      {content}
      {actions.contextMenu && (
        <FileExplorerContextMenu
          ctxMenu={actions.contextMenu}
          onClose={actions.closeContextMenu}
          onNewFile={() => actions.startCreate('file')}
          onNewFolder={() => actions.startCreate('folder')}
          onOpen={actions.openSelectedFile}
          onRename={actions.startRename}
          onDelete={() => void actions.deleteSelectedPath()}
          onOpenInSystem={(path) => void actions.revealSelectedPath(path)}
          onCopyPath={(path, withAt) => void actions.copySelectedPath(path, withAt)}
        />
      )}
      {actions.nameDialog}
    </div>
  );
}
