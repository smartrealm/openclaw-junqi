import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderX,
  Link,
  Loader2,
} from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import {
  openWithSystemDefault,
  readTerminalGitFileDiff,
  readTerminalWorkspaceDir,
  revealTerminalWorkspacePath,
  terminalPathInput,
  clearTerminalWorkspaceWatches,
  setTerminalWorkspaceWatches,
  type FsEntry,
} from '@/services/workspaceFs';
import { debugError } from '@/utils/debugLog';
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import { TERMINAL_CONTEXT_MENU_STYLE } from './terminalMenuStyles';
import { TerminalKookyMenuDivider, TerminalKookyMenuItem } from './KookyMenu';
import { requestTerminalInput } from './terminalChromeEvents';
import {
  serializeTerminalWorkspacePathDrop,
  TERMINAL_WORKSPACE_PATH_MIME,
} from './terminalWorkspacePathDrop';
import {
  buildTerminalGitDiffIndex,
  terminalWorkspacePathKey,
  type TerminalGitDiffCounts,
  type TerminalGitDiffIndex,
} from './terminalWorkspaceTree';

interface ContextMenuState {
  x: number;
  y: number;
}

interface TreeNodeProps {
  entry: FsEntry;
  root: string;
  depth: number;
  refreshVersion: number;
  diffIndex: TerminalGitDiffIndex;
  selectedPath: string | null;
  onSelect: (entry: FsEntry) => void;
  onOpen: (entry: FsEntry) => void;
  onReveal: (entry: FsEntry) => void;
  onCopyPath: (entry: FsEntry) => void;
  onInsertPath: (entry: FsEntry) => void;
  onExpandedDirectoryChange: (path: string, expanded: boolean) => void;
}

function terminalWorkspaceEntryKey(entry: FsEntry): string {
  const kind = entry.is_dir ? 'directory' : 'file';
  return `${entry.path}:${kind}:${entry.is_symlink ? 'link' : 'regular'}`;
}

function TerminalWorkspaceFileNode({
  entry,
  root,
  depth,
  refreshVersion,
  diffIndex,
  selectedPath,
  onSelect,
  onOpen,
  onReveal,
  onCopyPath,
  onInsertPath,
  onExpandedDirectoryChange,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [hovered, setHovered] = useState(false);
  const requestIdRef = useRef(0);
  const lastDirectoryToggleAtRef = useRef(0);
  const lastRefreshVersionRef = useRef(refreshVersion);
  // Keep every symlink leaf-only. An in-project link can point back to an
  // ancestor, and expanding it would make an unbounded tree representable.
  const isDirectory = entry.is_dir;
  const canExpand = isDirectory && !entry.is_symlink;

  useEffect(() => {
    if (!canExpand || !expanded) return;
    onExpandedDirectoryChange(entry.path, true);
    return () => onExpandedDirectoryChange(entry.path, false);
  }, [canExpand, entry.path, expanded, onExpandedDirectoryChange]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  const loadChildren = useCallback(async (showLoading = true) => {
    if (!canExpand) return;
    const requestId = ++requestIdRef.current;
    if (showLoading) setLoading(true);
    setLoadFailed(false);
    try {
      const next = await readTerminalWorkspaceDir(entry.path, root);
      if (requestId === requestIdRef.current) setChildren(next);
    } catch (error) {
      debugError('terminal', '[terminal] unable to read workspace directory:', error);
      if (requestId === requestIdRef.current) {
        setChildren([]);
        setLoadFailed(true);
      }
    } finally {
      if (showLoading && requestId === requestIdRef.current) setLoading(false);
    }
  }, [canExpand, entry.path, root]);

  useEffect(() => {
    if (lastRefreshVersionRef.current === refreshVersion) return;
    lastRefreshVersionRef.current = refreshVersion;
    if (expanded) void loadChildren(false);
  }, [expanded, loadChildren, refreshVersion]);

  const handleClick = useCallback(() => {
    onSelect(entry);
    if (!canExpand) return;
    const now = Date.now();
    if (now - lastDirectoryToggleAtRef.current < 280) return;
    lastDirectoryToggleAtRef.current = now;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children === null) void loadChildren();
  }, [canExpand, children, entry, expanded, loadChildren, onSelect]);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(
      TERMINAL_WORKSPACE_PATH_MIME,
      serializeTerminalWorkspacePathDrop({ path: entry.path, projectPath: root }),
    );
    event.dataTransfer.setData('text/plain', entry.path);
  }, [entry.path, root]);

  const selected = selectedPath === entry.path;
  const pathKey = terminalWorkspacePathKey(entry.path);
  const diff = canExpand
    ? (expanded ? undefined : diffIndex.directories.get(pathKey))
    : diffIndex.files.get(pathKey);
  const pathIndent = 8 + depth * 14;
  const menuLeft = contextMenu
    ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - 228))
    : 0;
  const menuTop = contextMenu
    ? Math.max(8, Math.min(contextMenu.y, window.innerHeight - (isDirectory ? 146 : 180)))
    : 0;
  const rowBackground = selected
    ? 'rgb(var(--aegis-overlay) / 0.15)'
    : hovered ? 'rgb(var(--aegis-overlay) / 0.07)' : 'transparent';
  const rowTextColor = selected
    ? 'rgb(var(--aegis-text))'
    : `rgb(var(--aegis-text) / ${hovered ? 0.95 : 0.82})`;
  const rowIconColor = selected
    ? 'rgb(var(--aegis-text))'
    : isDirectory
      ? 'rgb(var(--aegis-text) / 0.6)'
      : hovered ? 'rgb(var(--aegis-text) / 0.72)' : 'rgb(var(--aegis-text-muted))';

  return (
    <div className="terminal-kooky-file-tree-node">
      <button
        type="button"
        draggable
        onClick={() => { void handleClick(); }}
        onDoubleClick={() => { if (!canExpand) onOpen(entry); }}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelect(entry);
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onDragStart={handleDragStart}
        title={entry.path}
        style={{
          position: 'relative', width: '100%', minWidth: 0, minHeight: 24, display: 'flex', alignItems: 'center', gap: 0,
          padding: '3.5px 8px', paddingInlineStart: pathIndent,
          background: rowBackground,
          border: 'none', borderRadius: 6, color: rowTextColor,
          cursor: 'pointer', textAlign: 'start', opacity: entry.is_gitignored ? 0.5 : 1,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {depth > 0 && (
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {Array.from({ length: depth }, (_, level) => (
              <span
                key={level}
                style={{
                  position: 'absolute', insetBlock: 0, insetInlineStart: 8 + level * 14 + 6.5,
                  width: 1, background: 'rgb(var(--aegis-overlay) / 0.07)',
                }}
              />
            ))}
          </span>
        )}
        {canExpand ? (
          loading ? <Loader2 size={9} className="shrink-0 animate-spin" style={{ width: 14, color: selected || hovered ? 'rgb(var(--aegis-text-muted))' : 'rgb(var(--aegis-text-dim))', position: 'relative' }} />
            : expanded ? <ChevronDown size={9} strokeWidth={2.5} style={{ width: 14, flexShrink: 0, color: selected || hovered ? 'rgb(var(--aegis-text-muted))' : 'rgb(var(--aegis-text-dim))', position: 'relative' }} />
              : <ChevronRight size={9} strokeWidth={2.5} style={{ width: 14, flexShrink: 0, color: selected || hovered ? 'rgb(var(--aegis-text-muted))' : 'rgb(var(--aegis-text-dim))', position: 'relative' }} />
        ) : <span style={{ width: 14, flexShrink: 0, position: 'relative' }} />}
        {canExpand
          ? (expanded ? <FolderOpen size={11} style={{ width: 17, flexShrink: 0, color: rowIconColor, position: 'relative' }} /> : <Folder size={11} style={{ width: 17, flexShrink: 0, color: rowIconColor, position: 'relative' }} />)
          : entry.is_symlink ? <Link size={11} style={{ width: 17, flexShrink: 0, color: rowIconColor, position: 'relative' }} />
          : <File size={11} style={{ width: 17, flexShrink: 0, color: rowIconColor, position: 'relative' }} />}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, lineHeight: '15px', fontFamily: '"Kooky Onest", "Onest", sans-serif', paddingInlineStart: 2, position: 'relative' }}>
          {entry.name}
        </span>
        {diff && <TerminalGitDiffBadge counts={diff} />}
      </button>

      {expanded && loadFailed && (
        <div style={{ paddingInlineStart: pathIndent + 17, minHeight: 24, display: 'flex', alignItems: 'center', fontSize: 10, color: 'rgb(var(--aegis-danger))' }}>
          {t('terminal.fileAccessUnavailable')}
        </div>
      )}
      {expanded && children?.map((child) => (
        <TerminalWorkspaceFileNode
          key={terminalWorkspaceEntryKey(child)}
          entry={child}
          root={root}
          depth={depth + 1}
          refreshVersion={refreshVersion}
          diffIndex={diffIndex}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onOpen={onOpen}
          onReveal={onReveal}
          onCopyPath={onCopyPath}
          onInsertPath={onInsertPath}
          onExpandedDirectoryChange={onExpandedDirectoryChange}
        />
      ))}

      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
          className="terminal-kooky-menu"
          style={{
            position: 'fixed', left: menuLeft, top: menuTop, zIndex: 700,
            minWidth: 220, padding: 4, borderRadius: 0,
            ...TERMINAL_CONTEXT_MENU_STYLE,
          }}
        >
          {!isDirectory && (
            <TerminalKookyMenuItem
              label={t('terminal.openWithSystem')}
              onClick={() => { setContextMenu(null); onOpen(entry); }}
            />
          )}
          <TerminalKookyMenuItem
            label={t('terminal.revealInFileManager')}
            onClick={() => { setContextMenu(null); onReveal(entry); }}
          />
          <TerminalKookyMenuDivider />
          <TerminalKookyMenuItem
            label={t('terminal.copyPath')}
            onClick={() => { setContextMenu(null); onCopyPath(entry); }}
          />
          <TerminalKookyMenuItem
            label={t('terminal.insertPath')}
            onClick={() => { setContextMenu(null); onInsertPath(entry); }}
          />
        </div>
      )}
    </div>
  );
}

function TerminalGitDiffBadge({ counts }: { counts: TerminalGitDiffCounts }) {
  if (counts.insertions === 0 && counts.deletions === 0) {
    return (
      <span style={{ marginInlineStart: 'auto', flexShrink: 0, paddingInlineStart: 4, fontSize: 10, fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-muted))', position: 'relative' }}>
        ±
      </span>
    );
  }
  return (
    <span style={{ marginInlineStart: 'auto', flexShrink: 0, display: 'inline-flex', gap: 5, paddingInlineStart: 4, fontSize: 10, fontFamily: '"Kooky JetBrains Mono", "JetBrains Mono", monospace', position: 'relative' }}>
      {counts.insertions > 0 && <span style={{ color: 'rgb(115 199 128)' }}><span style={{ color: 'rgb(115 199 128 / 0.6)' }}>+</span>{counts.insertions}</span>}
      {counts.deletions > 0 && <span style={{ color: 'rgb(232 102 102)' }}><span style={{ color: 'rgb(232 102 102 / 0.6)' }}>−</span>{counts.deletions}</span>}
    </span>
  );
}

export interface TerminalWorkspaceFilesProps {
  root: string;
  refreshVersion?: number;
  /** Optional in-app file target. Without it, double-click keeps opening with the system default app. */
  onFileOpen?: (entry: FsEntry) => void;
}

export function TerminalWorkspaceFiles({ root, refreshVersion = 0, onFileOpen }: TerminalWorkspaceFilesProps) {
  const { t } = useTranslation();
  const addToast = useNotificationStore((state) => state.addToast);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [rootUnavailable, setRootUnavailable] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [gitDiffs, setGitDiffs] = useState<Awaited<ReturnType<typeof readTerminalGitFileDiff>>>(() => ({
    root,
    repository_root: null,
    files: [],
  }));
  const requestIdRef = useRef(0);
  const gitRequestIdRef = useRef(0);
  const lastRefreshVersionRef = useRef(refreshVersion);
  const watchIdRef = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `terminal-files-${crypto.randomUUID()}`
      : `terminal-files-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const watchGenerationRef = useRef(0);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const maxWatchedDirectories = 64;
  const [nativeRefreshVersion, setNativeRefreshVersion] = useState(0);
  const watchedPaths = useMemo(() => {
    const normalizedRoot = terminalWorkspacePathKey(root);
    const rootPrefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
    const visibleExpanded = [...expandedDirectories].filter((path) => {
      const normalizedPath = terminalWorkspacePathKey(path);
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootPrefix);
    });
    // Match Kooky: root plus the most recently expanded visible directories.
    // Keeping the native watcher set bounded avoids exhausting file handles in
    // monorepos with deep, permanently expanded trees.
    return [root, ...visibleExpanded.slice(-(maxWatchedDirectories - 1))];
  }, [expandedDirectories, root]);

  const setDirectoryExpanded = useCallback((path: string, expanded: boolean) => {
    setExpandedDirectories((current) => {
      const has = current.has(path);
      if (has === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | null = null;
    const watchId = watchIdRef.current;
    const generation = ++watchGenerationRef.current;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        setNativeRefreshVersion((version) => version + 1);
      }, 120);
    };
    const register = async () => {
      try {
        await setTerminalWorkspaceWatches(watchId, generation, root, watchedPaths);
      } catch (error) {
        if (!disposed) debugError('terminal', '[terminal] unable to watch workspace tree:', error);
      }
    };
    const unlisten = subscribeTauriEvent<{ watchId?: unknown }>('terminal-workspace-files-changed', (event) => {
      if (event.payload?.watchId === watchId) scheduleRefresh();
    }, (error) => {
      if (!disposed) debugError('terminal', '[terminal] unable to listen for workspace tree changes:', error);
    });
    void register();
    return () => {
      disposed = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      unlisten();
      void clearTerminalWorkspaceWatches(watchId, generation);
    };
  }, [root, watchedPaths]);

  const refresh = useCallback(async (showLoading = true) => {
    const requestId = ++requestIdRef.current;
    if (showLoading) setLoading(true);
    setRootUnavailable(false);
    try {
      const next = await readTerminalWorkspaceDir(root, root);
      if (requestId === requestIdRef.current) setEntries(next);
    } catch (error) {
      debugError('terminal', '[terminal] unable to read workspace root:', error);
      if (requestId === requestIdRef.current) {
        setEntries([]);
        setRootUnavailable(true);
      }
    } finally {
      if (showLoading && requestId === requestIdRef.current) setLoading(false);
    }
  }, [root]);

  const refreshGitDiff = useCallback(async () => {
    const requestId = ++gitRequestIdRef.current;
    try {
      const next = await readTerminalGitFileDiff(root);
      if (requestId === gitRequestIdRef.current) setGitDiffs(next);
    } catch {
      if (requestId === gitRequestIdRef.current) setGitDiffs({ root, repository_root: null, files: [] });
    }
  }, [root]);

  const gitDiffIndex = useMemo(
    () => buildTerminalGitDiffIndex(gitDiffs.root, gitDiffs.files),
    [gitDiffs],
  );
  const treeRefreshVersion = refreshVersion + nativeRefreshVersion;

  useEffect(() => {
    setEntries(null);
    setGitDiffs({ root, repository_root: null, files: [] });
    setSelectedPath(null);
    setExpandedDirectories(new Set());
    void refresh();
    void refreshGitDiff();
    return () => {
      requestIdRef.current += 1;
      gitRequestIdRef.current += 1;
    };
  }, [refresh, refreshGitDiff]);

  useEffect(() => {
    if (lastRefreshVersionRef.current === refreshVersion) return;
    lastRefreshVersionRef.current = refreshVersion;
    void refresh(false);
    void refreshGitDiff();
  }, [refresh, refreshGitDiff, refreshVersion]);

  useEffect(() => {
    if (nativeRefreshVersion === 0) return;
    void refresh(false);
    void refreshGitDiff();
  }, [nativeRefreshVersion, refresh, refreshGitDiff]);

  const reportFailure = useCallback((titleKey: string, bodyKey: string, error: unknown) => {
    debugError('terminal', `[terminal] ${titleKey}:`, error);
    addToast('error', t(titleKey), t(bodyKey));
  }, [addToast, t]);

  const handleOpen = useCallback(async (entry: FsEntry) => {
    if (onFileOpen) {
      onFileOpen(entry);
      return;
    }
    try {
      await openWithSystemDefault(entry.path, root);
    } catch (error) {
      reportFailure('terminal.fileOpenFailedTitle', 'terminal.fileOpenFailed', error);
    }
  }, [onFileOpen, reportFailure, root]);

  const handleReveal = useCallback(async (entry: FsEntry) => {
    try {
      await revealTerminalWorkspacePath(entry.path, root);
    } catch (error) {
      reportFailure('terminal.fileRevealFailedTitle', 'terminal.fileRevealFailed', error);
    }
  }, [reportFailure, root]);

  const handleCopyPath = useCallback(async (entry: FsEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
      addToast('info', t('terminal.copyPathDoneTitle'), t('terminal.copyPathDone'));
    } catch (error) {
      reportFailure('terminal.copyPathFailedTitle', 'terminal.copyPathFailed', error);
    }
  }, [addToast, reportFailure, t]);

  const handleInsertPath = useCallback(async (entry: FsEntry) => {
    try {
      const input = await terminalPathInput(entry.path, root);
      requestTerminalInput(input);
    } catch (error) {
      reportFailure('terminal.pathInsertFailedTitle', 'terminal.pathInsertFailed', error);
    }
  }, [reportFailure, root]);

  if (loading && entries === null) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--aegis-text-dim))' }}><Loader2 size={16} className="animate-spin" /></div>;
  }

  if (rootUnavailable) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 18, color: 'rgb(var(--aegis-text-dim))', textAlign: 'center' }}>
        <FolderX size={20} strokeWidth={1.6} />
        <span style={{ fontSize: 11 }}>{t('terminal.filesUnavailable')}</span>
        <button type="button" onClick={() => { void refresh(); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgb(var(--aegis-primary))', fontSize: 11 }}>
          {t('terminal.refreshFiles')}
        </button>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, color: 'rgb(var(--aegis-text-dim))', fontSize: 11, textAlign: 'center' }}>{t('terminal.filesEmpty')}</div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 4px 8px' }}>
      {entries.map((entry) => (
        <TerminalWorkspaceFileNode
          key={terminalWorkspaceEntryKey(entry)}
          entry={entry}
          root={root}
          depth={0}
          refreshVersion={treeRefreshVersion}
          diffIndex={gitDiffIndex}
          selectedPath={selectedPath}
          onSelect={(selected) => setSelectedPath(selected.path)}
          onOpen={(selected) => { void handleOpen(selected); }}
          onReveal={(selected) => { void handleReveal(selected); }}
          onCopyPath={(selected) => { void handleCopyPath(selected); }}
          onInsertPath={(selected) => { void handleInsertPath(selected); }}
          onExpandedDirectoryChange={setDirectoryExpanded}
        />
      ))}
    </div>
  );
}
