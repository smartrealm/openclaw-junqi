import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  Folder,
  FolderOpen,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import clsx from 'clsx';

export type SharePackageKind = 'agent' | 'skill';

export interface SharePackageSubject {
  kind: SharePackageKind;
  name: string;
  root: string;
  metadata: Record<string, unknown>;
  fileName?: string;
}

export interface SharePackageManifest {
  format: string;
  version: number;
  kind: SharePackageKind;
  name: string;
  createdAt: number;
  metadata: Record<string, unknown>;
  files: SharePackageFile[];
}

export interface SharePackageFile {
  path: string;
  size: number;
  executable: boolean;
  sensitive: boolean;
}

type PackageEntry = {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  recommended: boolean;
  sensitive: boolean;
  excludedReason?: string;
};

type TreeNode = {
  name: string;
  path: string;
  entry?: PackageEntry;
  children: TreeNode[];
  filePaths: string[];
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function packageLabel(kind: SharePackageKind): string {
  return kind === 'agent' ? 'Agent' : 'Skill';
}

function packageExtension(kind: SharePackageKind): string {
  return kind === 'agent' ? 'junqi-agent' : 'junqi-skill';
}

function safeFileStem(value: string): string {
  const stem = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return stem || 'share-package';
}

function buildTree(entries: PackageEntry[]): TreeNode[] {
  type MutableNode = Omit<TreeNode, 'children' | 'filePaths'> & { children: Map<string, MutableNode> };
  const root = new Map<string, MutableNode>();

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let children = root;
    let path = '';
    for (const [index, part] of parts.entries()) {
      path = path ? `${path}/${part}` : part;
      let node = children.get(part);
      if (!node) {
        node = { name: part, path, children: new Map() };
        children.set(part, node);
      }
      if (index === parts.length - 1) node.entry = entry;
      children = node.children;
    }
  }

  const finalize = (nodes: Map<string, MutableNode>): TreeNode[] => [...nodes.values()]
    .map((node) => {
      const children = finalize(node.children);
      const ownFile = node.entry?.kind === 'file' ? [node.path] : [];
      return {
        name: node.name,
        path: node.path,
        entry: node.entry,
        children,
        filePaths: [...ownFile, ...children.flatMap((child) => child.filePaths)],
      };
    })
    .sort((left, right) => {
      const leftDirectory = left.children.length > 0 || left.entry?.kind === 'directory';
      const rightDirectory = right.children.length > 0 || right.entry?.kind === 'directory';
      if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

  return finalize(root);
}

function CheckBox({ checked, indeterminate, disabled, onClick }: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={clsx(
        'grid size-4 shrink-0 place-items-center rounded border transition-colors',
        checked || indeterminate
          ? 'border-aegis-primary bg-aegis-primary text-aegis-btn-primary-text'
          : 'border-[rgb(var(--aegis-overlay)/0.18)] bg-transparent text-transparent hover:border-aegis-primary/60',
        disabled && 'cursor-not-allowed opacity-35 hover:border-[rgb(var(--aegis-overlay)/0.18)]',
      )}
    >
      {checked ? <Check size={11} strokeWidth={3} /> : indeterminate ? <span className="h-px w-2 bg-current" /> : null}
    </button>
  );
}

function PackageTreeNode({
  node,
  entriesByPath,
  selected,
  allowSensitive,
  onToggle,
  depth = 0,
}: {
  node: TreeNode;
  entriesByPath: Map<string, PackageEntry>;
  selected: Set<string>;
  allowSensitive: boolean;
  onToggle: (paths: string[], nextSelected: boolean) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const files = node.filePaths
    .map((path) => entriesByPath.get(path))
    .filter((entry): entry is PackageEntry => Boolean(entry));
  const selectable = files.filter((entry) => !entry.excludedReason || (entry.sensitive && allowSensitive));
  const selectedCount = selectable.filter((entry) => selected.has(entry.path)).length;
  const checked = selectable.length > 0 && selectedCount === selectable.length;
  const indeterminate = selectedCount > 0 && selectedCount < selectable.length;
  const disabled = selectable.length === 0;
  const fileEntry = node.entry?.kind === 'file' ? node.entry : undefined;
  const sensitiveLocked = Boolean(fileEntry?.sensitive && !allowSensitive);
  const label = fileEntry?.excludedReason && !allowSensitive
    ? fileEntry.excludedReason
    : fileEntry?.size
      ? `${fileEntry.path} - ${formatSize(fileEntry.size)}`
      : node.path;

  return (
    <li>
      <div
        className={clsx(
          'group flex min-h-7 items-center gap-2 rounded-md pe-2 text-[11px] transition-colors',
          disabled ? 'text-aegis-text-dim/70' : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.045)]',
        )}
        style={{ paddingInlineStart: `${8 + depth * 14}px` }}
        title={label}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => setExpanded((value) => !value)}
            className="grid size-4 shrink-0 place-items-center rounded text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : <span className="size-4 shrink-0" />}
        <CheckBox
          checked={checked}
          indeterminate={indeterminate}
          disabled={disabled}
          onClick={() => onToggle(selectable.map((entry) => entry.path), !checked)}
        />
        {hasChildren || node.entry?.kind === 'directory'
          ? <Folder size={13} className="shrink-0 text-aegis-primary/75" />
          : <File size={12} className={clsx('shrink-0', sensitiveLocked ? 'text-aegis-warning' : 'text-aegis-text-dim')} />}
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        {fileEntry?.sensitive && <ShieldAlert size={12} className="shrink-0 text-aegis-warning" />}
        {fileEntry && <span className="shrink-0 font-mono text-[9px] text-aegis-text-dim">{formatSize(fileEntry.size)}</span>}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <PackageTreeNode
              key={child.path}
              node={child}
              entriesByPath={entriesByPath}
              selected={selected}
              allowSensitive={allowSensitive}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function PackageTree({
  entries,
  selected,
  allowSensitive,
  onToggle,
}: {
  entries: PackageEntry[];
  selected: Set<string>;
  allowSensitive: boolean;
  onToggle: (paths: string[], nextSelected: boolean) => void;
}) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const entriesByPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  return (
    <ul className="max-h-[min(45vh,420px)] overflow-y-auto border-y border-[rgb(var(--aegis-overlay)/0.08)] py-1">
      {tree.map((node) => (
        <PackageTreeNode
          key={node.path}
          node={node}
          entriesByPath={entriesByPath}
          selected={selected}
          allowSensitive={allowSensitive}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function DialogFrame({ children, onClose, title, subtitle }: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="fixed inset-0 z-[2147482000] grid place-items-center bg-black/55 px-4 py-5 backdrop-blur-sm" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[calc(100dvh-40px)] w-full max-w-[900px] flex-col overflow-hidden rounded-lg border border-[rgb(var(--aegis-overlay)/0.12)] bg-aegis-bg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[rgb(var(--aegis-overlay)/0.08)] px-5 py-4">
          <Archive size={18} className="mt-0.5 text-aegis-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-aegis-text">{title}</h2>
            <p className="mt-0.5 text-[11px] text-aegis-text-dim">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text"
          >
            <X size={15} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function ExportSharePackageDialog({
  open,
  subject,
  onClose,
  onExported,
}: {
  open: boolean;
  subject: SharePackageSubject | null;
  onClose: () => void;
  onExported?: (result: { destination: string; fileCount: number; totalBytes: number }) => void;
}) {
  const [scan, setScan] = useState<{ root: string; entries: PackageEntry[]; omittedDirectories: string[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitiveNotice, setSensitiveNotice] = useState(false);

  useEffect(() => {
    if (!open || !subject) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScan(null);
    setSelected(new Set());
    setIncludeSensitive(false);
    setSensitiveNotice(false);
    void window.aegis.sharePackages.scan(subject.root)
      .then((result) => {
        if (cancelled) return;
        const entries = result.entries as PackageEntry[];
        setScan({ root: result.root, entries, omittedDirectories: result.omittedDirectories });
        setSelected(new Set(entries.filter((entry) => entry.kind === 'file' && entry.recommended).map((entry) => entry.path)));
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, subject?.root]);

  useEffect(() => {
    if (includeSensitive) return;
    setSelected((current) => {
      if (!scan) return current;
      const next = new Set(current);
      scan.entries.filter((entry) => entry.sensitive).forEach((entry) => next.delete(entry.path));
      return next;
    });
  }, [includeSensitive, scan]);

  const selectedFiles = useMemo(() => scan?.entries.filter((entry) => entry.kind === 'file' && selected.has(entry.path)) ?? [], [scan, selected]);
  const selectedBytes = useMemo(() => selectedFiles.reduce((sum, entry) => sum + entry.size, 0), [selectedFiles]);

  if (!open || !subject) return null;

  const toggle = (paths: string[], nextSelected: boolean) => {
    if (!scan) return;
    const entryMap = new Map(scan.entries.map((entry) => [entry.path, entry]));
    const sensitivePaths = paths.filter((path) => entryMap.get(path)?.sensitive);
    if (nextSelected && sensitivePaths.length > 0 && !includeSensitive) setSensitiveNotice(true);
    setSelected((current) => {
      const next = new Set(current);
      for (const path of paths) {
        const entry = entryMap.get(path);
        if (!entry || entry.kind !== 'file') continue;
        if (nextSelected) {
          if (!entry.excludedReason || (entry.sensitive && includeSensitive)) next.add(path);
        } else {
          next.delete(path);
        }
      }
      return next;
    });
  };

  const selectRecommended = () => {
    if (!scan) return;
    setSelected(new Set(scan.entries.filter((entry) => entry.kind === 'file' && entry.recommended).map((entry) => entry.path)));
    setSensitiveNotice(false);
  };

  const handleExport = async () => {
    if (!subject || selectedFiles.length === 0) return;
    setError(null);
    try {
      const destination = await saveDialog({
        title: `Export ${packageLabel(subject.kind)}`,
        defaultPath: `${safeFileStem(subject.fileName || subject.name)}.${packageExtension(subject.kind)}.zip`,
        filters: [{ name: 'JunQi Share Package', extensions: ['zip'] }],
      });
      if (!destination) return;
      setExporting(true);
      const result = await window.aegis.sharePackages.export({
        kind: subject.kind,
        name: subject.name,
        root: subject.root,
        destination,
        selectedPaths: [...selected],
        includeSensitive,
        metadata: subject.metadata,
      });
      onExported?.(result);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  };

  return (
    <DialogFrame
      title={`Export ${packageLabel(subject.kind)}`}
      subtitle={subject.name}
      onClose={exporting ? () => {} : onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid min-h-[320px] place-items-center"><Loader2 size={22} className="animate-spin text-aegis-primary" /></div>
        ) : error ? (
          <div className="m-5 flex items-start gap-3 border border-aegis-danger/25 bg-aegis-danger/[0.06] p-4 text-[12px] text-aegis-text-secondary">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-aegis-danger" />
            <span className="break-words">{error}</span>
          </div>
        ) : scan ? (
          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_230px]">
            <div className="min-w-0 px-5 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] font-semibold text-aegis-text">Package contents</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={selectRecommended} className="rounded-md px-2 py-1 text-[10px] font-medium text-aegis-primary hover:bg-aegis-primary/[0.08]">Recommended</button>
                  <button type="button" onClick={() => setSelected(new Set())} className="rounded-md px-2 py-1 text-[10px] font-medium text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.06)]">Clear</button>
                </div>
              </div>
              <PackageTree entries={scan.entries} selected={selected} allowSensitive={includeSensitive} onToggle={toggle} />
              {sensitiveNotice && (
                <div className="mt-3 flex items-start gap-2 border-s-2 border-aegis-warning/60 ps-3 text-[10px] leading-relaxed text-aegis-text-muted">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0 text-aegis-warning" />
                  <span>Sensitive files remain unselected until you explicitly allow them.</span>
                </div>
              )}
            </div>
            <aside className="border-t border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)] px-5 py-4 md:border-s md:border-t-0">
              <div className="text-[10px] font-semibold uppercase text-aegis-text-dim">Package</div>
              <div className="mt-2 text-[13px] font-semibold text-aegis-text">{subject.name}</div>
              <div className="mt-4 border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-3">
                <div className="text-[10px] text-aegis-text-dim">Selected files</div>
                <div className="mt-1 font-mono text-[15px] font-semibold text-aegis-text">{selectedFiles.length}</div>
                <div className="mt-3 text-[10px] text-aegis-text-dim">Estimated size</div>
                <div className="mt-1 font-mono text-[15px] font-semibold text-aegis-text">{formatSize(selectedBytes)}</div>
              </div>
              <label className="mt-5 flex cursor-pointer items-start gap-2 border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-4 text-[10px] text-aegis-text-muted">
                <input
                  type="checkbox"
                  checked={includeSensitive}
                  onChange={(event) => setIncludeSensitive(event.target.checked)}
                  className="mt-0.5 accent-[rgb(var(--aegis-primary))]"
                />
                <span>Allow selected sensitive files</span>
              </label>
              {scan.omittedDirectories.length > 0 && (
                <div className="mt-4 border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-3 text-[10px] leading-relaxed text-aegis-text-dim">
                  Runtime and dependency folders are omitted from this package.
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgb(var(--aegis-overlay)/0.08)] px-5 py-3">
        <button type="button" disabled={exporting} onClick={onClose} className="rounded-md px-3 py-1.5 text-[11px] font-medium text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-50">Cancel</button>
        <button
          type="button"
          disabled={loading || exporting || selectedFiles.length === 0 || Boolean(error)}
          onClick={() => void handleExport()}
          className="inline-flex items-center gap-1.5 rounded-md bg-aegis-primary px-3 py-1.5 text-[11px] font-semibold text-aegis-btn-primary-text transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
          {exporting ? 'Exporting' : 'Export package'}
        </button>
      </footer>
    </DialogFrame>
  );
}

function suggestedTargetName(manifest: SharePackageManifest): string {
  const meta = manifest.kind === 'agent' ? manifest.metadata.agent : manifest.metadata.skill;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const record = meta as Record<string, unknown>;
    const raw = String(record.id ?? record.dirName ?? record.slug ?? record.name ?? '').trim();
    if (raw) return safeFileStem(raw);
  }
  return safeFileStem(manifest.name);
}

export function ImportSharePackageDialog({
  open,
  acceptedKind,
  onClose,
  onBeforeImport,
  onImported,
}: {
  open: boolean;
  acceptedKind: SharePackageKind;
  onClose: () => void;
  onBeforeImport?: (manifest: SharePackageManifest, targetPath: string) => string | null | Promise<string | null>;
  onImported?: (result: { manifest: SharePackageManifest; targetPath: string; importedFiles: number; skippedFiles: number }) => void | Promise<void>;
}) {
  const [inspection, setInspection] = useState<{ packagePath: string; manifest: SharePackageManifest } | null>(null);
  const [targetParent, setTargetParent] = useState('');
  const [targetName, setTargetName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ targetPath: string; selectedFiles: SharePackageFile[]; conflicts: Array<{ path: string; existingKind: 'file' | 'directory' | 'symlink' }> } | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<'error' | 'skip' | 'overwrite'>('skip');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setInspection(null);
    setTargetParent('');
    setTargetName('');
    setSelected(new Set());
    setPreview(null);
    setConflictStrategy('skip');
    setLoading(false);
    setImporting(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const entries: PackageEntry[] = inspection?.manifest.files.map((file) => ({
    path: file.path,
    kind: 'file',
    size: file.size,
    recommended: true,
    sensitive: file.sensitive,
  })) ?? [];
  const selectedFiles = entries.filter((entry) => selected.has(entry.path));
  const selectedBytes = selectedFiles.reduce((sum, entry) => sum + entry.size, 0);

  const invalidatePreview = () => setPreview(null);
  const toggle = (paths: string[], nextSelected: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      paths.forEach((path) => nextSelected ? next.add(path) : next.delete(path));
      return next;
    });
    invalidatePreview();
  };

  const choosePackage = async () => {
    setError(null);
    try {
      const selectedPath = await openDialog({
        title: `Import ${packageLabel(acceptedKind)} package`,
        multiple: false,
        filters: [{ name: 'JunQi Share Package', extensions: ['zip'] }],
      });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      setLoading(true);
      const result = await window.aegis.sharePackages.inspect(selectedPath);
      if (result.manifest.kind !== acceptedKind) {
        throw new Error(`This package contains a ${packageLabel(result.manifest.kind)}, not a ${packageLabel(acceptedKind)}.`);
      }
      setInspection(result);
      setTargetName(suggestedTargetName(result.manifest));
      setSelected(new Set(result.manifest.files.map((file) => file.path)));
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const chooseTargetParent = async () => {
    try {
      const selectedPath = await openDialog({
        title: 'Choose destination folder',
        directory: true,
        multiple: false,
      });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      setTargetParent(selectedPath);
      invalidatePreview();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const checkConflicts = async () => {
    if (!inspection || !targetParent || !targetName.trim() || selected.size === 0) return;
    setError(null);
    setLoading(true);
    try {
      const nextPreview = await window.aegis.sharePackages.previewImport({
        sourcePath: inspection.packagePath,
        targetParent,
        targetName: targetName.trim(),
        selectedPaths: [...selected],
      });
      const preflightError = await onBeforeImport?.(inspection.manifest, nextPreview.targetPath);
      if (preflightError) throw new Error(preflightError);
      setPreview(nextPreview);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!inspection || !preview) return;
    setError(null);
    setImporting(true);
    try {
      const result = await window.aegis.sharePackages.import({
        sourcePath: inspection.packagePath,
        targetParent,
        targetName: targetName.trim(),
        selectedPaths: [...selected],
        conflictStrategy,
      });
      await onImported?.({ manifest: inspection.manifest, ...result });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  };

  return (
    <DialogFrame
      title={`Import ${packageLabel(acceptedKind)}`}
      subtitle={inspection?.manifest.name ?? 'Choose a JunQi share package'}
      onClose={importing ? () => {} : onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!inspection ? (
          <div className="grid min-h-[290px] place-items-center px-5 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.08] text-aegis-primary"><FileArchive size={20} /></div>
              <button type="button" onClick={() => void choosePackage()} disabled={loading} className="mt-4 inline-flex items-center gap-2 rounded-md bg-aegis-primary px-3 py-2 text-[12px] font-semibold text-aegis-btn-primary-text disabled:opacity-50">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                Choose package
              </button>
              {error && <div className="mt-4 max-w-[440px] border-s-2 border-aegis-danger ps-3 text-left text-[11px] text-aegis-text-muted">{error}</div>}
            </div>
          </div>
        ) : (
          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_250px]">
            <div className="min-w-0 px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-aegis-text">{inspection.manifest.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim">{inspection.packagePath}</div>
                </div>
                <button type="button" onClick={() => void choosePackage()} className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium text-aegis-primary hover:bg-aegis-primary/[0.08]">Change</button>
              </div>
              <div className="mb-3 flex items-center justify-between gap-2 text-[10px]">
                <span className="font-medium text-aegis-text-muted">Files to import</span>
                <button type="button" onClick={() => { setSelected(new Set(inspection.manifest.files.map((file) => file.path))); invalidatePreview(); }} className="text-aegis-primary hover:underline">Select all</button>
              </div>
              <PackageTree entries={entries} selected={selected} allowSensitive onToggle={toggle} />

              <div className="mt-4 border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-4">
                <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">Destination</div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void chooseTargetParent()} className="min-w-0 flex-1 truncate rounded-md border border-[rgb(var(--aegis-overlay)/0.12)] bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2 text-left font-mono text-[11px] text-aegis-text-secondary hover:border-aegis-primary/35">
                    {targetParent || 'Choose parent folder'}
                  </button>
                  <input
                    value={targetName}
                    onChange={(event) => { setTargetName(event.target.value); invalidatePreview(); }}
                    aria-label="Import folder name"
                    className="w-[150px] rounded-md border border-[rgb(var(--aegis-overlay)/0.12)] bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary/45"
                  />
                </div>
              </div>

              {preview && (
                <div className={clsx('mt-4 border-s-2 ps-3 text-[11px]', preview.conflicts.length > 0 ? 'border-aegis-warning' : 'border-aegis-success')}>
                  <div className="font-medium text-aegis-text">{preview.conflicts.length > 0 ? `${preview.conflicts.length} conflicts found` : 'No destination conflicts'}</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-aegis-text-dim">{preview.targetPath}</div>
                  {preview.conflicts.length > 0 && (
                    <div className="mt-3 flex items-center gap-1.5">
                      <button type="button" onClick={() => setConflictStrategy('skip')} className={clsx('rounded-md px-2 py-1 text-[10px] font-medium', conflictStrategy === 'skip' ? 'bg-aegis-primary/12 text-aegis-primary' : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)]')}>Skip existing</button>
                      <button type="button" onClick={() => setConflictStrategy('overwrite')} className={clsx('rounded-md px-2 py-1 text-[10px] font-medium', conflictStrategy === 'overwrite' ? 'bg-aegis-danger/[0.11] text-aegis-danger' : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)]')}>Replace existing</button>
                    </div>
                  )}
                </div>
              )}
              {error && <div className="mt-4 flex items-start gap-2 border-s-2 border-aegis-danger ps-3 text-[11px] text-aegis-text-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-aegis-danger" />{error}</div>}
            </div>
            <aside className="border-t border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)] px-5 py-4 md:border-s md:border-t-0">
              <div className="text-[10px] font-semibold uppercase text-aegis-text-dim">Import summary</div>
              <div className="mt-3 text-[10px] text-aegis-text-dim">Selected files</div>
              <div className="mt-1 font-mono text-[15px] font-semibold text-aegis-text">{selectedFiles.length}</div>
              <div className="mt-3 text-[10px] text-aegis-text-dim">Package size</div>
              <div className="mt-1 font-mono text-[15px] font-semibold text-aegis-text">{formatSize(selectedBytes)}</div>
              {entries.some((entry) => entry.sensitive) && (
                <div className="mt-5 flex items-start gap-2 border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-4 text-[10px] leading-relaxed text-aegis-text-muted">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0 text-aegis-warning" />
                  <span>This package includes files marked sensitive by its sender.</span>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
      {inspection && (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgb(var(--aegis-overlay)/0.08)] px-5 py-3">
          <button type="button" disabled={importing} onClick={onClose} className="rounded-md px-3 py-1.5 text-[11px] font-medium text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-50">Cancel</button>
          {!preview ? (
            <button type="button" disabled={loading || !targetParent || !targetName.trim() || selected.size === 0} onClick={() => void checkConflicts()} className="inline-flex items-center gap-1.5 rounded-md bg-aegis-primary px-3 py-1.5 text-[11px] font-semibold text-aegis-btn-primary-text disabled:cursor-not-allowed disabled:opacity-45">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
              Review import
            </button>
          ) : (
            <button type="button" disabled={importing} onClick={() => void handleImport()} className="inline-flex items-center gap-1.5 rounded-md bg-aegis-primary px-3 py-1.5 text-[11px] font-semibold text-aegis-btn-primary-text disabled:cursor-not-allowed disabled:opacity-45">
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
              {importing ? 'Importing' : 'Import package'}
            </button>
          )}
        </footer>
      )}
    </DialogFrame>
  );
}
