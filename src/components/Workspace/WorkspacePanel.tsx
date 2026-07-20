/**
 * Agent workspace panel. Resolves an agent's workspace directory, shows a lazy
 * file tree, and opens files into a CodeMirror editor or an image preview.
 * Edits save back via write_file_content (Ctrl/Cmd+S or the Save button).
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import type { Extension } from '@codemirror/state';
import { ChevronLeft, RefreshCw, Save, Loader2, FileWarning, FolderOpen } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import {
  readFileText, writeFileText, readImagePreview, getWorkspacePath, isImageExt,
  type FsEntry, type ImagePreview,
} from '@/services/workspaceFs';
import { loadCodeMirrorLanguage } from '@/utils/codeMirrorLanguages';
import { showConfirm } from '@/components/shared/AlertDialog';

interface OpenFile {
  entry: FsEntry;
  content: string;
  saved: string;
  image: ImagePreview | null;
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
  const theme = useSettingsStore((s) => s.theme);
  const isDark = theme === 'aegis-dark'
    || (theme === 'system' && (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true));

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
  const dirty = !!open && open.image === null && open.error === null && open.content !== open.saved;

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
    if (!open || open.image !== null || open.error !== null) return;
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
  }, [open?.entry.name, open?.entry.extension, open?.image, open?.error]);

  const loadFile = useCallback(async (entry: FsEntry) => {
    if (!root) return;
    const requestId = ++loadRequestRef.current;
    setSaveError(null);
    setLoadingFile(true);
    try {
      if (isImageExt(entry.extension)) {
        const img = await readImagePreview(entry.path, root);
        if (requestId !== loadRequestRef.current) return;
        setOpen({ entry, content: '', saved: '', image: img, error: null });
      } else {
        const text = await readFileText(entry.path, root);
        if (requestId !== loadRequestRef.current) return;
        setOpen({ entry, content: text, saved: text, image: null, error: null });
      }
    } catch (e: any) {
      if (requestId !== loadRequestRef.current) return;
      setOpen({ entry, content: '', saved: '', image: null, error: e?.message || t('workspace.previewFailed', 'Unable to preview this file') });
    } finally {
      if (requestId === loadRequestRef.current) setLoadingFile(false);
    }
  }, [root, t]);

  const openFile = useCallback((entry: FsEntry) => {
    const cur = openRef.current;
    if (cur && cur.image === null && cur.error === null && cur.content !== cur.saved) {
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
    if (current && current.image === null && current.error === null && current.content !== current.saved) {
      showConfirm(
        t('workspace.discardUnsavedTitle', 'Unsaved changes'),
        t('workspace.closeUnsavedConfirm', 'Discard unsaved changes in "{{name}}" and close the workspace?', { name: current.entry.name }),
        onClose,
      );
      return;
    }
    onClose();
  }, [onClose, saving, t]);

  const save = useCallback(async () => {
    if (!open || !root || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await writeFileText(open.entry.path, open.content, root);
      setOpen((o) => (o ? { ...o, saved: o.content } : o));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
    finally { setSaving(false); }
  }, [open, root, dirty, saving]);

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
            <WorkspaceFileTree key={`${root}:${treeKey}`} root={root} activePath={open?.entry.path ?? null} onOpenFile={openFile} />
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
              {open.image === null && open.error === null && (
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
            ) : open.image ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6">
                <img src={open.image.data_url} alt={open.entry.name} className="max-h-[calc(100vh-190px)] max-w-full rounded border border-[rgb(var(--aegis-overlay)/0.1)] object-contain" />
                <span className="text-[10px] text-aegis-text-dim">{open.image.mime_type} · {(open.image.byte_length / 1024).toFixed(1)} KB</span>
              </div>
            ) : (
              <div className="flex min-h-full flex-col">
                {saveError && (
                  <div className="m-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 px-3 py-2 text-[11px] text-aegis-danger">
                    {t('workspace.saveFailed', 'Save failed')}: {saveError}
                  </div>
                )}
                <CodeMirror
                  value={open.content}
                  theme={isDark ? githubDark : githubLight}
                  extensions={[languageExtension]}
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
