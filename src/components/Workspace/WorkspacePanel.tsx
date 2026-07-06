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
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { xml } from '@codemirror/lang-xml';
import { ChevronLeft, RefreshCw, Save, Loader2, FileWarning } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import {
  readFileText, writeFileText, readImagePreview, getWorkspacePath, isImageExt,
  type FsEntry, type ImagePreview,
} from '@/services/workspaceFs';

function langFor(ext?: string | null): Extension[] {
  switch ((ext || '').toLowerCase()) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return [javascript({ jsx: true })];
    case 'ts': case 'tsx': return [javascript({ jsx: true, typescript: true })];
    case 'py': return [python()];
    case 'rs': return [rust()];
    case 'go': return [go()];
    case 'json': return [json()];
    case 'md': case 'mdx': case 'markdown': return [markdown()];
    case 'html': case 'htm': case 'vue': case 'svelte': return [html()];
    case 'css': case 'scss': case 'less': return [css()];
    case 'yaml': case 'yml': return [yaml()];
    case 'sql': return [sql()];
    case 'java': case 'kt': return [java()];
    case 'c': case 'h': case 'cpp': case 'hpp': case 'cc': case 'cxx': return [cpp()];
    case 'xml': case 'toml': case 'svg': return [xml()];
    default: return [];
  }
}

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

  // Resolve the target agent's workspace dir (fall back to the runtime default).
  const agentId = useMemo(() => agentIdProp || activeKey?.split(':')[1] || 'main', [agentIdProp, activeKey]);
  useEffect(() => {
    let alive = true;
    setOpen(null);
    setSaveError(null);
    (async () => {
      if (rootOverride) {
        if (alive) { setRoot(rootOverride); setRootErr(false); }
        return;
      }
      const agent = agents.find((a) => a.id === agentId);
      if (agent?.workspace) { if (alive) { setRoot(agent.workspace); setRootErr(false); } return; }
      try { const wp = await getWorkspacePath(); if (alive) { setRoot(wp); setRootErr(false); } }
      catch { if (alive) { setRoot(null); setRootErr(true); } }
    })();
    return () => { alive = false; };
  }, [agentId, agents, rootOverride]);

  // Keep the latest open file in a ref so openFile can guard unsaved edits
  // without depending on `open` (which would rebuild the callback each edit).
  const openRef = useRef<OpenFile | null>(null);
  useEffect(() => { openRef.current = open; }, [open]);

  const openFile = useCallback(async (entry: FsEntry) => {
    if (!root) return;
    setSaveError(null);
    // Guard unsaved edits before switching files.
    const cur = openRef.current;
    if (cur && cur.image === null && cur.error === null && cur.content !== cur.saved) {
      if (!window.confirm(t('workspace.discardUnsavedConfirm', 'Discard unsaved changes in "{{name}}" and open another file?', { name: cur.entry.name }))) return;
    }
    setLoadingFile(true);
    try {
      if (isImageExt(entry.extension)) {
        const img = await readImagePreview(entry.path, root);
        setOpen({ entry, content: '', saved: '', image: img, error: null });
      } else {
        const text = await readFileText(entry.path, root);
        setOpen({ entry, content: text, saved: text, image: null, error: null });
      }
    } catch (e: any) {
      setOpen({ entry, content: '', saved: '', image: null, error: e?.message || t('workspace.previewFailed', 'Unable to preview this file') });
    } finally {
      setLoadingFile(false);
    }
  }, [root, t]);

  const dirty = !!open && open.image === null && open.error === null && open.content !== open.saved;

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
    <div
      onKeyDown={onKeyDown}
      className="flex flex-col h-full w-full bg-aegis-bg-frosted-60 border-s border-[rgb(var(--aegis-overlay)/0.08)]"
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 h-9 px-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] shrink-0">
        {open ? (
          <>
            <button onClick={() => setOpen(null)} title={t('workspace.backToTree', 'Back to file tree')}
              className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text">
              <ChevronLeft size={15} />
            </button>
            <span className="text-[12px] font-medium text-aegis-text truncate flex-1" title={open.entry.path}>
              {open.entry.name}{dirty ? ' •' : ''}
            </span>
            {open.image === null && open.error === null && (
              <button onClick={save} disabled={!dirty || saving} title={t('workspace.saveShortcut', 'Save (⌘S)')}
                className="p-1 rounded text-aegis-primary disabled:opacity-30 hover:bg-aegis-primary/10">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-aegis-text-muted truncate flex-1" title={root || ''}>
              {wsName || t('workspace.title', 'Workspace')}
            </span>
            <button onClick={() => setTreeKey((k) => k + 1)} title={t('common.refresh', 'Refresh')}
              className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text">
              <RefreshCw size={13} />
            </button>
            {onClose && (
              <button onClick={onClose} title={t('workspace.collapse', 'Collapse workspace')}
                className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text">
                <ChevronLeft size={15} className="rotate-180" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loadingFile ? (
          <div className="flex items-center justify-center py-8 text-aegis-text-dim"><Loader2 size={16} className="animate-spin" /></div>
        ) : open ? (
          open.error ? (
            <div className="p-4 text-center text-aegis-text-dim">
              <FileWarning size={22} className="mx-auto mb-2 opacity-40" />
              <p className="text-[11px]">{open.error}</p>
            </div>
          ) : open.image ? (
            <div className="p-3 flex flex-col items-center gap-2">
              <img src={open.image.data_url} alt={open.entry.name} className="max-w-full rounded border border-[rgb(var(--aegis-overlay)/0.1)]" />
              <span className="text-[10px] text-aegis-text-dim">{open.image.mime_type} · {(open.image.byte_length / 1024).toFixed(1)} KB</span>
            </div>
          ) : (
            <div className="min-h-full">
              {saveError && (
                <div className="m-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 px-3 py-2 text-[11px] text-aegis-danger">
                  {t('workspace.saveFailed', 'Save failed')}: {saveError}
                </div>
              )}
              <CodeMirror
                value={open.content}
                theme={isDark ? githubDark : githubLight}
                extensions={langFor(open.entry.extension)}
                onChange={(v) => { setSaveError(null); setOpen((o) => (o ? { ...o, content: v } : o)); }}
                basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true }}
                style={{ fontSize: 12.5 }}
              />
            </div>
          )
        ) : rootErr || !root ? (
          <div className="p-4 text-center text-[11px] text-aegis-text-dim">{t('workspace.locateFailed', "Unable to locate this agent's workspace directory")}</div>
        ) : (
          <WorkspaceFileTree key={`${root}:${treeKey}`} root={root} activePath={null} onOpenFile={openFile} />
        )}
      </div>
    </div>
  );
}
