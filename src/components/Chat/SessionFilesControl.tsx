import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  FileText,
  Folder,
  Image,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  gateway,
  type OpenClawSessionFile,
  type OpenClawSessionFilesList,
} from '@/services/gateway';

interface SessionFilesControlProps {
  sessionKey: string;
  agentId: string;
}

const SESSION_FILE_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function imageSource(file: OpenClawSessionFile): string | null {
  if (
    file.previewKind !== 'image'
    || file.contentEncoding !== 'base64'
    || !file.mimeType
    || !SESSION_FILE_IMAGE_MIME_TYPES.has(file.mimeType)
    || !file.content
  ) return null;
  return `data:${file.mimeType};base64,${file.content}`;
}

export function SessionFilesControl({ sessionKey, agentId }: SessionFilesControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OpenClawSessionFilesList | null>(null);
  const [selected, setSelected] = useState<OpenClawSessionFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (path?: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const value = await gateway.listSessionFiles(sessionKey, { agentId, ...(path !== undefined ? { path } : {}) });
      if (requestId === requestIdRef.current) {
        setSnapshot(value);
        setSelected(null);
        setLoading(false);
      }
    } catch (cause) {
      if (requestId === requestIdRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      }
    }
  }, [agentId, sessionKey]);

  const selectFile = useCallback(async (file: OpenClawSessionFile) => {
    if (file.missing) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const value = await gateway.getSessionFile(sessionKey, file.workspacePath ?? file.path, agentId);
      if (requestId === requestIdRef.current) {
        setSelected(value.file);
        setLoading(false);
      }
    } catch (cause) {
      if (requestId === requestIdRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      }
    }
  }, [agentId, sessionKey]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
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
  const image = selected ? imageSource(selected) : null;
  const hasTouchedFiles = (snapshot?.files.length ?? 0) > 0;
  const hasBrowserEntries = (browser?.entries.length ?? 0) > 0;

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
          className="absolute end-0 top-full z-50 mt-2 flex max-h-[min(620px,calc(100vh-88px))] w-[min(620px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
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
            <button type="button" onClick={() => { void load(browser?.path); }} disabled={loading} title={t('chat.sessionFiles.refresh')} aria-label={t('chat.sessionFiles.refresh')} className="grid size-7 place-items-center rounded-md text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.07)] disabled:opacity-50">
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} aria-hidden="true" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,0.7fr)_minmax(0,1.3fr)] overflow-hidden">
            <div className="min-h-0 overflow-y-auto border-e border-aegis-border p-2">
              {hasTouchedFiles && <p className="px-2 pb-1 text-[9px] font-medium text-aegis-text-dim">{t('chat.sessionFiles.touched')}</p>}
              {snapshot?.files.map((file) => (
                <button key={`touched:${file.path}`} type="button" disabled={file.missing} onClick={() => { void selectFile(file); }} className={clsx('mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[10px] transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:cursor-not-allowed disabled:opacity-50', selected?.path === file.path && 'bg-aegis-primary/10 text-aegis-primary')}>
                  <FileText size={12} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                  <span className="text-[9px] text-aegis-text-dim">{t(`chat.sessionFiles.kind.${file.kind}`)}</span>
                </button>
              ))}
              {hasBrowserEntries && <p className="mt-2 border-t border-aegis-border px-2 pt-2 text-[9px] font-medium text-aegis-text-dim">{t('chat.sessionFiles.workspace')}</p>}
              {browser?.entries.map((entry) => (
                <button key={`browser:${entry.path}`} type="button" onClick={() => {
                  if (entry.kind === 'directory') void load(entry.path);
                  else void selectFile({ path: entry.path, name: entry.name, kind: entry.sessionKind === 'read' ? 'read' : 'modified', missing: false });
                }} className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[10px] text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)]">
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
              {selected && !loading && !error && (image ? <img src={image} alt={selected.name} className="max-h-80 max-w-full object-contain" /> : selected.previewKind === 'text' && selected.contentEncoding === 'utf8' && selected.content !== undefined ? <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-aegis-text-secondary">{selected.content}</pre> : <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-dim"><Image size={14} aria-hidden="true" />{t('chat.sessionFiles.previewUnavailable')}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
