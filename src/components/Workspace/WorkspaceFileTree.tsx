/**
 * Lazy-loading file tree for an agent workspace. Directories load their
 * children on first expand (readDir) and cache them; files bubble a click up
 * to `onOpenFile`. Kept presentational — all IO goes through workspaceFs.
 */
import { useEffect, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { readDir, type FsEntry } from '@/services/workspaceFs';

function TreeNode({
  entry, root, depth, activePath, onOpenFile,
}: {
  entry: FsEntry;
  root: string;
  depth: number;
  activePath: string | null;
  onOpenFile: (entry: FsEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(false);
    try { setChildren(await readDir(entry.path, root)); }
    catch { setErr(true); setChildren([]); }
    finally { setLoading(false); }
  }, [entry.path, root]);

  const toggle = async () => {
    if (!entry.is_dir) { onOpenFile(entry); return; }
    if (!open && children === null) await load();
    setOpen((o) => !o);
  };

  const active = activePath === entry.path;
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        title={entry.name}
        className={[
          'w-full flex items-center gap-1 py-[3px] pe-2 rounded text-[12px] text-start transition-colors',
          active ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text',
          entry.is_gitignored ? 'opacity-45' : '',
        ].join(' ')}
        style={{ paddingInlineStart: 6 + depth * 12 }}
      >
        {entry.is_dir ? (
          loading
            ? <Loader2 size={13} className="shrink-0 animate-spin" />
            : (open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />)
        ) : <span className="w-[13px] shrink-0" />}
        {entry.is_dir
          ? (open ? <FolderOpen size={13} className="shrink-0 text-aegis-primary/70" /> : <Folder size={13} className="shrink-0 text-aegis-primary/70" />)
          : <File size={13} className="shrink-0 text-aegis-text-dim" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && children && children.map((c) => (
        <TreeNode key={c.path} entry={c} root={root} depth={depth + 1} activePath={activePath} onOpenFile={onOpenFile} />
      ))}
      {open && err && <div className="text-[10px] text-aegis-danger/70" style={{ paddingInlineStart: 6 + (depth + 1) * 12 }}>读取失败</div>}
    </div>
  );
}

export function WorkspaceFileTree({
  root, activePath, onOpenFile,
}: {
  root: string;
  activePath: string | null;
  onOpenFile: (entry: FsEntry) => void;
}) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setEntries(await readDir(root, root)); }
    catch (e: any) { setErr(e?.message || String(e)); setEntries([]); }
    finally { setLoading(false); }
  }, [root]);

  useEffect(() => { load(); }, [load]);

  if (loading && !entries) {
    return <div className="flex items-center justify-center py-8 text-aegis-text-dim"><Loader2 size={16} className="animate-spin" /></div>;
  }
  if (err) {
    return (
      <div className="p-3 text-center">
        <p className="text-[11px] text-aegis-danger/80 mb-2 break-words">{err}</p>
        <button onClick={load} className="text-[11px] text-aegis-text-muted hover:text-aegis-text inline-flex items-center gap-1">
          <RefreshCw size={11} /> 重试
        </button>
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <div className="p-4 text-center text-[11px] text-aegis-text-dim">工作区为空</div>;
  }
  return (
    <div className="py-1">
      {entries.map((e) => (
        <TreeNode key={e.path} entry={e} root={root} depth={0} activePath={activePath} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}
