/**
 * Agent workspace panel. Resolves an agent's workspace directory, shows a lazy
 * file tree, and opens files into a text editor or a typed read-only preview.
 * Text edits save back via write_file_content (Ctrl/Cmd+S or the Save button).
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';
import type { Extension } from '@codemirror/state';
import { ChevronLeft, RefreshCw, Save, Loader2, FileWarning, FolderOpen } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useTheme } from '@/theme/useTheme';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import { FileReadOnlyPreview } from '@/components/FileExplorer/FileReadOnlyPreview';
import { pathIsTargetOrDescendant, rebaseOpenFilePath } from '@/components/FileExplorer/openFilePaths';
import {
  readFilePreview, writeFileText, getWorkspacePath, type FsEntry,
} from '@/services/workspaceFs';
import type { WorkspaceFilePreview } from '@/utils/filePreviewCapabilities';
import { loadCodeMirrorLanguage } from '@/utils/codeMirrorLanguages';
import { aegisCodeMirrorBaseTheme, getCodeMirrorColorTheme } from '@/utils/codeMirrorTheme';
import { showConfirm } from '@/components/shared/AlertDialog';

interface OpenFile {
  entry: FsEntry;
  content: string;
  saved: string;
  preview: WorkspaceFilePreview | null;
  error: string | null;
}

interface WorkspacePanelProps {
  onClose?: () => void;
  agentId?: string;
  rootOverride?: string;
}

export function WorkspacePanel({ onClose, agentId: agentIdProp, rootOverride }: WorkspacePanelProps) {
  const { t } = useTranslation();
  const activeKey = useChatStore((s) => s.activeSessionKey);
  const agents = useGatewayDataStore((s) => s.agents);
  const resolvedTheme = useTheme();
  const editorTheme = getCodeMirrorColorTheme(resolvedTheme);

  const [root, setRoot] = useState<string | null>(null);
  const [rootErr, setRootErr] = useState(false);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0); // bump to force tree reload
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const rootRef = useRef<string | null>(null);
  const openRef = useRef<OpenFile | null>(null);
  const loadRequestRef = useRef(0);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const dirty = !!open && open.preview?.kind === 'text' && open.error === null && open.content !== open.saved;

  // Resolve the target agent's workspace dir (fall back to the runtime default).
  const agentId = useMemo(() => agentIdProp || activeKey?.split(':')[1] || 'main', [agentIdProp, activeKey]);
  const agentWorkspace = useMemo(
    () => agents.find((candidate) => candidate.id === agentId)?.workspace,
    [agentId, agents],
  );
  useEffect(() => {
    let alive = true;
    const applyRoot = (nextRoot: string | null, failed: boolean) => {
      if (!alive || rootRef.current === nextRoot) {
        if (alive) setRootErr(failed);
        return;
      }
      if (dirty) return;
      loadRequestRef.current += 1;
      rootRef.current = nextRoot;
      setRoot(nextRoot);
      setRootErr(failed);
      setOpen(null);
      setSaveError(null);
    };
    (async () => {
      if (rootOverride) {
        applyRoot(rootOverride, false);
        return;
      }
      if (agentWorkspace) {
        applyRoot(agentWorkspace, false);
        return;
      }
      try { applyRoot(await getWorkspacePath(), false); }
      catch { applyRoot(null, true); }
    })();
    return () => { alive = false; };
  }, [agentId, agentWorkspace, dirty, rootOverride]);

  // Keep the latest open file in a ref so openFile can guard unsaved edits
  // without depending on `open` (which would rebuild the callback each edit).
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    let alive = true;
    setLanguageExtension([]);
    if (!open || open.preview?.kind !== 'text' || open.error !== null) return;
    loadCodeMirrorLanguage(open.entry.name || open.entry.extension)
      .then((extension) => {
        if (alive) setLanguageExtension(extension);
      })
      .catch(() => {
        if (alive) setLanguageExtension([]);
      });
    return () => {
      alive = false;
    };
  }, [open?.entry.name, open?.entry.extension, open?.preview?.kind, open?.error]);

  const loadFile = useCallback(async (entry: FsEntry) => {
    if (!root) return;
    const requestId = ++loadRequestRef.current;
    setSaveError(null);
    setLoadingFile(true);
    try {
      const preview = await readFilePreview(entry.path, root);
      if (requestId !== loadRequestRef.current) return;
      const text = preview.kind === 'text' ? preview.text : '';
      setOpen({ entry, content: text, saved: text, preview, error: null });
    } catch (e: any) {
      if (requestId !== loadRequestRef.current) return;
      setOpen({ entry, content: '', saved: '', preview: null, error: e?.message || t('workspace.previewFailed', 'Unable to preview this file') });
    } finally {
      if (requestId === loadRequestRef.current) setLoadingFile(false);
    }
  }, [root, t]);

  const openFile = useCallback((entry: FsEntry) => {
    const cur = openRef.current;
    if (cur?.preview?.kind === 'text' && cur.error === null && cur.content !== cur.saved) {
      showConfirm(
        t('workspace.discardUnsavedTitle', 'Unsaved changes'),
        t('workspace.discardUnsavedConfirm', 'Discard unsaved changes in "{{name}}" and open another file?', { name: cur.entry.name }),
        () => { void loadFile(entry); },
      );
      return;
    }
    void loadFile(entry);
  }, [loadFile, t]);

  const requestClose = useCallback(() => {
    if (!onClose || saving) return;
    const current = openRef.current;
    if (current?.preview?.kind === 'text' && current.error === null && current.content !== current.saved) {
      showConfirm(
        t('workspace.discardUnsavedTitle', 'Unsaved changes'),
        t('workspace.closeUnsavedConfirm', 'Discard unsaved changes in "{{name}}" and close the workspace?', { name: current.entry.name }),
        onClose,
      );
      return;
    }
    onClose();
  }, [onClose, saving, t]);

  const persistCurrentOpenFile = useCallback(async () => {
    if (saveInFlightRef.current) await saveInFlightRef.current;
    const current = openRef.current;
    const currentRoot = rootRef.current;
    if (!current || !currentRoot || current.preview?.kind !== 'text' || current.error !== null || current.content === current.saved) return;
    const path = current.entry.path;
    const content = current.content;
    const task = (async () => {
      setSaving(true);
      setSaveError(null);
      try {
        await writeFileText(path, content, currentRoot);
        setOpen((candidate) => candidate?.entry.path === path ? { ...candidate, saved: content } : candidate);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        setSaving(false);
      }
    })();
    saveInFlightRef.current = task;
    try {
      await task;
    } finally {
      if (saveInFlightRef.current === task) saveInFlightRef.current = null;
    }
  }, []);

  const save = useCallback(() => {
    void persistCurrentOpenFile().catch(() => undefined);
  }, [persistCurrentOpenFile]);

  const handleBeforePathMutation = useCallback(async (path: string, isDirectory: boolean) => {
    const current = openRef.current;
    if (!current || !pathIsTargetOrDescendant(current.entry.path, path, isDirectory)) return;
    await persistCurrentOpenFile();
  }, [persistCurrentOpenFile]);

  const handlePathRenamed = useCallback((oldPath: string, newPath: string, isDirectory: boolean) => {
    setOpen((current) => {
      if (!current) return current;
      const path = rebaseOpenFilePath(current.entry.path, oldPath, newPath, isDirectory);
      if (path === current.entry.path) return current;
      const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
      return { ...current, entry: { ...current.entry, path, name } };
    });
  }, []);

  const handlePathDeleted = useCallback((path: string, isDirectory: boolean) => {
    setOpen((current) => current && pathIsTargetOrDescendant(current.entry.path, path, isDirectory) ? null : current);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  };

  const wsName = root ? root.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || root : '';

  return (
    <div onKeyDown={onKeyDown} className="flex h-full min-h-0 w-full bg-aegis-bg-frosted-60">
      <aside className="flex w-[clamp(210px,24%,300px)] shrink-0 flex-col border-e border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)]">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3">
          <FolderOpen size={14} className="shrink-0 text-aegis-primary" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-aegis-text" title={root || ''}>
            {wsName || t('workspace.title', 'Workspace')}
          </span>
          <button onClick={() => setTreeKey((k) => k + 1)} title={t('common.refresh', 'Refresh')}
            className="rounded p-1 text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary">
            <RefreshCw size={13} />
          </button>
          {onClose && (
            <button onClick={requestClose} disabled={saving} title={t('workspace.collapse', 'Collapse workspace')}
              className="rounded p-1 text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary">
              <ChevronLeft size={15} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1">
          {rootErr || !root ? (
            <div className="p-4 text-center text-[11px] text-aegis-text-dim">{t('workspace.locateFailed', "Unable to locate this agent's workspace directory")}</div>
          ) : (
            <WorkspaceFileTree
              key={`${root}:${treeKey}`}
              root={root}
              activePath={open?.entry.path ?? null}
              onOpenFile={openFile}
              onBeforePathMutation={handleBeforePathMutation}
              onPathRenamed={handlePathRenamed}
              onPathDeleted={handlePathDeleted}
            />
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-aegis-bg">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3">
          {open ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-aegis-text" title={open.entry.path}>
                {open.entry.name}{dirty ? ' •' : ''}
              </span>
              {open.preview?.kind === 'text' && open.error === null && (
                <button onClick={save} disabled={!dirty || saving} title={t('workspace.saveShortcut', 'Save (⌘S)')}
                  className="rounded p-1.5 text-aegis-primary transition-colors hover:bg-aegis-primary/10 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                </button>
              )}
            </>
          ) : (
            <span className="text-[11px] text-aegis-text-dim">{t('workspace.selectFile', 'Select a file to edit or preview')}</span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loadingFile ? (
            <div className="flex h-full items-center justify-center text-aegis-text-dim"><Loader2 size={16} className="animate-spin" /></div>
          ) : open ? (
            open.error ? (
              <div className="p-4 text-center text-aegis-text-dim">
                <FileWarning size={22} className="mx-auto mb-2 opacity-40" />
                <p className="text-[11px]">{open.error}</p>
              </div>
            ) : open.preview && open.preview.kind !== 'text' && root ? (
              <FileReadOnlyPreview
                preview={open.preview}
                fileName={open.entry.name}
                filePath={open.entry.path}
                projectPath={root}
              />
            ) : (
              <div className="flex min-h-full flex-col">
                {saveError && (
                  <div className="m-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 px-3 py-2 text-[11px] text-aegis-danger">
                    {t('workspace.saveFailed', 'Save failed')}: {saveError}
                  </div>
                )}
                <CodeMirror
                  value={open.content}
                  theme={editorTheme}
                  extensions={[languageExtension, aegisCodeMirrorBaseTheme]}
                  onChange={(v) => { setSaveError(null); setOpen((o) => (o ? { ...o, content: v } : o)); }}
                  basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true }}
                  height="100%"
                  style={{ flex: 1, fontSize: 12.5 }}
                />
              </div>
            )
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div>
                <FolderOpen size={30} className="mx-auto mb-3 text-aegis-text-dim opacity-30" />
                <p className="text-[12px] font-medium text-aegis-text-muted">{t('workspace.selectFile', 'Select a file to edit or preview')}</p>
                <p className="mt-1 text-[10px] text-aegis-text-dim">{wsName}</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
