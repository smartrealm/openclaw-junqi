import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  FileText,
  Folder,
  Image,
  LoaderCircle,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  gateway,
  OpenClawSessionFileConflictError,
  type OpenClawSessionFile,
  type OpenClawSessionFilesList,
} from '@/services/gateway';
import {
  gatewayImagePreviewContent,
  textFilePreviewContent,
  type FilePreviewContent,
} from '@/file-preview/content';
import { FilePreviewSurface } from '@/components/FileExplorer/FilePreviewSurface';
import { SessionFileCodeEditor } from './SessionFileCodeEditor';
import {
  canEditSessionFile,
  sessionFileDraftKey,
  type SessionFileDraft,
} from './sessionFileEditState';

interface SessionFilesControlProps {
  readonly sessionKey: string;
  readonly agentId: string;
}

interface SessionFileScope {
  readonly connectionId: string;
  readonly root?: string;
  readonly path: string;
}

type SaveOutcome = 'idle' | 'saved' | 'conflict' | 'error';

interface ActiveSessionFile {
  readonly file: OpenClawSessionFile;
  readonly scope: SessionFileScope;
  readonly draft?: SessionFileDraft;
  readonly saveOutcome: SaveOutcome;
}

function sessionFilePreviewContent(file: OpenClawSessionFile): FilePreviewContent | null {
  if (file.previewKind === 'image' && file.contentEncoding === 'base64') {
    return gatewayImagePreviewContent(file.mimeType, file.content);
  }
  if (file.previewKind === 'text' && file.contentEncoding === 'utf8' && file.content !== undefined) {
    return textFilePreviewContent(file.name, file.content);
  }
  return null;
}

function sameScope(left: SessionFileScope, right: SessionFileScope): boolean {
  return left.connectionId === right.connectionId
    && left.root === right.root
    && left.path === right.path;
}

export function SessionFilesControl({ sessionKey, agentId }: SessionFilesControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OpenClawSessionFilesList | null>(null);
  const [active, setActive] = useState<ActiveSessionFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const operationEpochRef = useRef(0);
  const draftsRef = useRef(new Map<string, SessionFileDraft>());

  const draftKey = useCallback((scope: SessionFileScope) => sessionFileDraftKey({
    connectionId: scope.connectionId,
    sessionKey,
    agentId,
    root: scope.root,
    path: scope.path,
  }), [agentId, sessionKey]);

  const load = useCallback(async (path?: string) => {
    const epoch = operationEpochRef.current + 1;
    operationEpochRef.current = epoch;
    setLoading(true);
    setSaving(false);
    setError(null);
    try {
      const result = await gateway.listSessionFiles(sessionKey, {
        agentId,
        ...(path === undefined ? {} : { path }),
      });
      if (epoch !== operationEpochRef.current) return;
      setSnapshot(result);
      setActive(null);
    } catch (cause) {
      if (epoch === operationEpochRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (epoch === operationEpochRef.current) setLoading(false);
    }
  }, [agentId, sessionKey]);

  const selectFile = useCallback(async (
    requestedFile: OpenClawSessionFile,
    discardRetainedDraft = false,
  ) => {
    if (requestedFile.missing) return;
    const epoch = operationEpochRef.current + 1;
    operationEpochRef.current = epoch;
    setLoading(true);
    setSaving(false);
    setError(null);
    try {
      const result = await gateway.getSessionFile(
        sessionKey,
        requestedFile.workspacePath ?? requestedFile.path,
        agentId,
      );
      if (epoch !== operationEpochRef.current) return;
      const scope: SessionFileScope = {
        connectionId: result.gatewayConnectionId,
        ...(result.root === undefined ? {} : { root: result.root }),
        path: result.file.workspacePath ?? result.file.path,
      };
      const key = draftKey(scope);
      const retained = draftsRef.current.get(key);
      if (discardRetainedDraft) draftsRef.current.delete(key);
      const eligible = canEditSessionFile(result.file);
      const draft = eligible && !discardRetainedDraft && retained?.content !== result.file.content
        ? retained
        : eligible
          ? { content: result.file.content, expectedHash: result.file.hash }
          : undefined;
      if (retained && draft === undefined) draftsRef.current.delete(key);
      if (retained?.content === result.file.content) draftsRef.current.delete(key);
      setActive({ file: result.file, scope, ...(draft ? { draft } : {}), saveOutcome: 'idle' });
    } catch (cause) {
      if (epoch === operationEpochRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (epoch === operationEpochRef.current) setLoading(false);
    }
  }, [agentId, draftKey, sessionKey]);

  const updateDraft = useCallback((content: string) => {
    setActive((current) => {
      if (!current?.draft || !canEditSessionFile(current.file)) return current;
      const nextDraft = { content, expectedHash: current.draft.expectedHash };
      const key = draftKey(current.scope);
      if (content === current.file.content) draftsRef.current.delete(key);
      else draftsRef.current.set(key, nextDraft);
      return { ...current, draft: nextDraft, saveOutcome: 'idle' };
    });
  }, [draftKey]);

  const reloadActiveFile = useCallback(() => {
    if (active) void selectFile(active.file, true);
  }, [active, selectFile]);

  const saveActiveFile = useCallback(async () => {
    if (!active?.draft || !canEditSessionFile(active.file) || saving) return;
    const epoch = operationEpochRef.current;
    const submittedScope = active.scope;
    const submittedDraft = active.draft;
    setSaving(true);
    setActive((current) => current && sameScope(current.scope, submittedScope)
      ? { ...current, saveOutcome: 'idle' }
      : current);
    try {
      const result = await gateway.setSessionFile(
        sessionKey,
        submittedScope.path,
        submittedDraft.content,
        submittedDraft.expectedHash,
        agentId,
        submittedScope.connectionId,
      );
      if (epoch !== operationEpochRef.current) return;
      setActive((current) => {
        if (!current?.draft || !sameScope(current.scope, submittedScope)) return current;
        const nextScope: SessionFileScope = {
          ...submittedScope,
          ...(result.root === undefined ? {} : { root: result.root }),
        };
        const nextFile: OpenClawSessionFile = {
          ...current.file,
          ...result.file,
          content: submittedDraft.content,
          contentEncoding: 'utf8',
          previewKind: 'text',
        };
        const draftChangedDuringSave = current.draft.content !== submittedDraft.content;
        const nextDraft = {
          content: draftChangedDuringSave ? current.draft.content : submittedDraft.content,
          expectedHash: result.file.hash!,
        };
        draftsRef.current.delete(draftKey(submittedScope));
        if (nextDraft.content !== nextFile.content) {
          draftsRef.current.set(draftKey(nextScope), nextDraft);
        }
        return {
          file: nextFile,
          scope: nextScope,
          draft: nextDraft,
          saveOutcome: draftChangedDuringSave ? 'idle' : 'saved',
        };
      });
    } catch (cause) {
      if (epoch !== operationEpochRef.current) return;
      setActive((current) => {
        if (!current || !sameScope(current.scope, submittedScope)) return current;
        return {
          ...current,
          saveOutcome: cause instanceof OpenClawSessionFileConflictError ? 'conflict' : 'error',
        };
      });
    } finally {
      if (epoch === operationEpochRef.current) setSaving(false);
    }
  }, [active, agentId, draftKey, saving, sessionKey]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const browser = snapshot?.browser;
  const selected = active?.file ?? null;
  const preview = selected ? sessionFilePreviewContent(selected) : null;
  const editor = active?.draft && selected && canEditSessionFile(selected)
    ? { active, draft: active.draft }
    : null;
  const hasTouchedFiles = (snapshot?.files.length ?? 0) > 0;
  const hasBrowserEntries = (browser?.entries.length ?? 0) > 0;
  const editorDocumentId = useMemo(() => editor
    ? `${draftKey(editor.active.scope)}\0${editor.draft.expectedHash}`
    : '', [draftKey, editor]);

  return (
    <div ref={rootRef} className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('chat.sessionFiles.open')}
        aria-label={t('chat.sessionFiles.open')}
        className={clsx(
          'inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
      >
        <FileText size={11} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.sessionFiles.title')}
          className="absolute end-0 top-full z-50 mt-2 flex max-h-[min(620px,calc(100vh-88px))] w-[min(700px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="flex items-center gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.sessionFiles.title')}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim" title={sessionKey}>{sessionKey}</div>
            </div>
            {browser?.parentPath !== undefined && (
              <button type="button" onClick={() => { void load(browser.parentPath); }} title={t('chat.sessionFiles.parent')} aria-label={t('chat.sessionFiles.parent')} className="grid size-7 place-items-center rounded-md text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.07)]">
                <ChevronLeft size={13} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={() => { void load(browser?.path); }} disabled={loading || saving} title={t('chat.sessionFiles.refresh')} aria-label={t('chat.sessionFiles.refresh')} className="grid size-7 place-items-center rounded-md text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.07)] disabled:opacity-50">
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} aria-hidden="true" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,0.65fr)_minmax(0,1.35fr)] overflow-hidden">
            <div className="min-h-0 overflow-y-auto border-e border-aegis-border p-2">
              {hasTouchedFiles && <p className="px-2 pb-1 text-[9px] font-medium text-aegis-text-dim">{t('chat.sessionFiles.touched')}</p>}
              {snapshot?.files.map((file) => (
                <button key={`touched:${file.path}`} type="button" disabled={file.missing || saving} onClick={() => { void selectFile(file); }} className={clsx('mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[10px] transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:cursor-not-allowed disabled:opacity-50', selected?.path === file.path && 'bg-aegis-primary/10 text-aegis-primary')}>
                  <FileText size={12} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                  <span className="text-[9px] text-aegis-text-dim">{t(`chat.sessionFiles.kind.${file.kind}`)}</span>
                </button>
              ))}
              {hasBrowserEntries && <p className="mt-2 border-t border-aegis-border px-2 pt-2 text-[9px] font-medium text-aegis-text-dim">{t('chat.sessionFiles.workspace')}</p>}
              {browser?.entries.map((entry) => (
                <button key={`browser:${entry.path}`} type="button" disabled={saving} onClick={() => {
                  if (entry.kind === 'directory') void load(entry.path);
                  else void selectFile({ path: entry.path, name: entry.name, kind: entry.sessionKind === 'read' ? 'read' : 'modified', missing: false });
                }} className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[10px] text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-50">
                  {entry.kind === 'directory' ? <Folder size={12} className="shrink-0 text-aegis-primary" aria-hidden="true" /> : <FileText size={12} className="shrink-0" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 overflow-auto p-3">
              {loading && <div role="status" className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-muted"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t('chat.sessionFiles.loading')}</div>}
              {!loading && error && <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 p-2.5 text-[11px] text-aegis-text-muted"><div className="flex items-start gap-2"><AlertCircle size={14} className="shrink-0 text-aegis-danger" aria-hidden="true" />{t('chat.sessionFiles.error')}</div><div className="break-words font-mono text-[10px] text-aegis-text-dim">{error}</div></div>}
              {!loading && !error && !hasTouchedFiles && !hasBrowserEntries && <p className="py-5 text-center text-[11px] text-aegis-text-dim">{t('chat.sessionFiles.empty')}</p>}
              {!loading && !error && !selected && (hasTouchedFiles || hasBrowserEntries) && <p className="py-5 text-center text-[11px] text-aegis-text-dim">{t('chat.sessionFiles.select')}</p>}
              {selected && !loading && !error && (editor ? <div className="flex min-h-full flex-col gap-2"><SessionFileCodeEditor documentId={editorDocumentId} name={selected.name} content={editor.draft.content} readOnly={saving} onChange={updateDraft} onSave={() => { void saveActiveFile(); }} /><div className="flex items-center justify-between gap-2"><div className="min-w-0 text-[10px] text-aegis-text-dim">{editor.active.saveOutcome === 'saved' ? t('chat.sessionFiles.saved') : editor.active.saveOutcome === 'conflict' ? t('chat.sessionFiles.conflict') : editor.active.saveOutcome === 'error' ? t('chat.sessionFiles.saveFailed') : null}</div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={reloadActiveFile} disabled={saving} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.07)] disabled:opacity-50"><RefreshCw size={11} aria-hidden="true" />{t('chat.sessionFiles.reload')}</button><button type="button" onClick={() => { void saveActiveFile(); }} disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-aegis-primary px-2 py-1 text-[10px] text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-50">{saving ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> : <Save size={11} aria-hidden="true" />}{saving ? t('chat.sessionFiles.saving') : t('chat.sessionFiles.save')}</button></div></div></div> : preview ? <FilePreviewSurface content={preview} fileName={selected.name} compact /> : <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-dim"><Image size={14} aria-hidden="true" />{t('chat.sessionFiles.previewUnavailable')}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
