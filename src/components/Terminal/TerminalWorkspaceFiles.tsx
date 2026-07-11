import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  FolderX,
  Loader2,
  SquareTerminal,
} from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import {
  openWithSystemDefault,
  readTerminalWorkspaceDir,
  revealTerminalWorkspacePath,
  terminalPathInput,
  type FsEntry,
} from '@/services/workspaceFs';
import { debugError } from '@/utils/debugLog';
import {
  serializeTerminalWorkspacePathDrop,
  TERMINAL_WORKSPACE_PATH_MIME,
} from './terminalWorkspacePathDrop';

interface ContextMenuState {
  x: number;
  y: number;
}

interface TreeNodeProps {
  entry: FsEntry;
  root: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (entry: FsEntry) => void;
  onOpen: (entry: FsEntry) => void;
  onReveal: (entry: FsEntry) => void;
  onCopyPath: (entry: FsEntry) => void;
  onInsertPath: (entry: FsEntry) => void;
}

function TerminalWorkspaceFileNode({
  entry,
  root,
  depth,
  selectedPath,
  onSelect,
  onOpen,
  onReveal,
  onCopyPath,
  onInsertPath,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const requestIdRef = useRef(0);
  const lastDirectoryToggleAtRef = useRef(0);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  const loadChildren = useCallback(async () => {
    if (!entry.is_dir) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
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
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [entry.is_dir, entry.path, root]);

  const handleClick = useCallback(async () => {
    onSelect(entry);
    if (!entry.is_dir) return;
    const now = Date.now();
    if (now - lastDirectoryToggleAtRef.current < 280 || loading) return;
    lastDirectoryToggleAtRef.current = now;
    if (expanded) {
      setExpanded(false);
      return;
    }
    await loadChildren();
    setExpanded(true);
  }, [entry, expanded, loadChildren, loading, onSelect]);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(
      TERMINAL_WORKSPACE_PATH_MIME,
      serializeTerminalWorkspacePathDrop({ path: entry.path, projectPath: root }),
    );
    event.dataTransfer.setData('text/plain', entry.path);
  }, [entry.path, root]);

  const selected = selectedPath === entry.path;
  const pathIndent = 8 + depth * 13;
  const menuLeft = contextMenu
    ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - 228))
    : 0;
  const menuTop = contextMenu
    ? Math.max(8, Math.min(contextMenu.y, window.innerHeight - (entry.is_dir ? 146 : 180)))
    : 0;

  return (
    <div>
      <button
        type="button"
        draggable
        onClick={() => { void handleClick(); }}
        onDoubleClick={() => { if (!entry.is_dir) onOpen(entry); }}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelect(entry);
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onDragStart={handleDragStart}
        title={entry.path}
        style={{
          width: '100%', minWidth: 0, height: 28, display: 'flex', alignItems: 'center', gap: 5,
          paddingInlineStart: pathIndent, paddingInlineEnd: 8,
          background: selected ? 'rgb(var(--aegis-primary) / 0.13)' : 'transparent',
          border: 'none', borderRadius: 4, color: selected ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-dim))',
          cursor: 'pointer', textAlign: 'start', opacity: entry.is_gitignored ? 0.5 : 1,
        }}
        onMouseEnter={(event) => {
          if (!selected) (event.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay) / 0.06)';
        }}
        onMouseLeave={(event) => {
          if (!selected) (event.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        {entry.is_dir ? (
          loading ? <Loader2 size={12} className="shrink-0 animate-spin" />
            : expanded ? <ChevronDown size={12} className="shrink-0" />
              : <ChevronRight size={12} className="shrink-0" />
        ) : <span style={{ width: 12, flexShrink: 0 }} />}
        {entry.is_dir
          ? (expanded ? <FolderOpen size={13} className="shrink-0 text-aegis-primary/75" /> : <Folder size={13} className="shrink-0 text-aegis-primary/75" />)
          : <File size={13} className="shrink-0" />}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace' }}>
          {entry.name}
        </span>
      </button>

      {expanded && loadFailed && (
        <div style={{ paddingInlineStart: pathIndent + 17, minHeight: 24, display: 'flex', alignItems: 'center', fontSize: 10, color: 'rgb(var(--aegis-danger))' }}>
          {t('terminal.fileAccessUnavailable')}
        </div>
      )}
      {expanded && children?.map((child) => (
        <TerminalWorkspaceFileNode
          key={child.path}
          entry={child}
          root={root}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onOpen={onOpen}
          onReveal={onReveal}
          onCopyPath={onCopyPath}
          onInsertPath={onInsertPath}
        />
      ))}

      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            position: 'fixed', left: menuLeft, top: menuTop, zIndex: 700,
            minWidth: 220, padding: '4px 0', borderRadius: 6,
            background: 'rgb(var(--aegis-elevated))', border: '1px solid rgb(255 255 255 / 0.1)',
            boxShadow: '0 10px 28px rgb(0 0 0 / 0.35)',
          }}
        >
          {!entry.is_dir && (
            <TerminalWorkspaceFileMenuItem
              icon={<ExternalLink size={13} />}
              label={t('terminal.openWithSystem')}
              onClick={() => { setContextMenu(null); onOpen(entry); }}
            />
          )}
          <TerminalWorkspaceFileMenuItem
            icon={<FolderOpen size={13} />}
            label={t('terminal.revealInFileManager')}
            onClick={() => { setContextMenu(null); onReveal(entry); }}
          />
          <div style={{ height: 1, margin: '4px 0', background: 'rgb(255 255 255 / 0.07)' }} />
          <TerminalWorkspaceFileMenuItem
            icon={<Copy size={13} />}
            label={t('terminal.copyPath')}
            onClick={() => { setContextMenu(null); onCopyPath(entry); }}
          />
          <TerminalWorkspaceFileMenuItem
            icon={<SquareTerminal size={13} />}
            label={t('terminal.insertPath')}
            onClick={() => { setContextMenu(null); onInsertPath(entry); }}
          />
        </div>
      )}
    </div>
  );
}

function TerminalWorkspaceFileMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        width: '100%', height: 28, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'rgb(var(--aegis-text))', fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace', textAlign: 'start',
      }}
      onMouseEnter={(event) => { (event.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay) / 0.08)'; }}
      onMouseLeave={(event) => { (event.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', color: 'rgb(var(--aegis-text-dim))' }}>{icon}</span>
      {label}
    </button>
  );
}

export function TerminalWorkspaceFiles({ root }: { root: string }) {
  const { t } = useTranslation();
  const addToast = useNotificationStore((state) => state.addToast);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [rootUnavailable, setRootUnavailable] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
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
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    setEntries(null);
    setSelectedPath(null);
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const reportFailure = useCallback((titleKey: string, bodyKey: string, error: unknown) => {
    debugError('terminal', `[terminal] ${titleKey}:`, error);
    addToast('error', t(titleKey), t(bodyKey));
  }, [addToast, t]);

  const handleOpen = useCallback(async (entry: FsEntry) => {
    try {
      await openWithSystemDefault(entry.path, root);
    } catch (error) {
      reportFailure('terminal.fileOpenFailedTitle', 'terminal.fileOpenFailed', error);
    }
  }, [reportFailure, root]);

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
      window.dispatchEvent(new CustomEvent('junqi:paste-terminal-input', { detail: { input } }));
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
          key={entry.path}
          entry={entry}
          root={root}
          depth={0}
          selectedPath={selectedPath}
          onSelect={(selected) => setSelectedPath(selected.path)}
          onOpen={(selected) => { void handleOpen(selected); }}
          onReveal={(selected) => { void handleReveal(selected); }}
          onCopyPath={(selected) => { void handleCopyPath(selected); }}
          onInsertPath={(selected) => { void handleInsertPath(selected); }}
        />
      ))}
    </div>
  );
}
