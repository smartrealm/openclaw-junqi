import { useCallback, useState } from 'react';
import { AlertCircle, Copy, ExternalLink, FileText, FileCode, FileImage, FileSpreadsheet, FolderOpen, Info, PanelRightOpen, RefreshCw, Sparkles, Layers, type LucideIcon } from 'lucide-react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { DecisionOption, FileRef, SessionEvent, WorkshopEvent } from '@/types/RenderBlock';
import { useNotificationStore } from '@/stores/notificationStore';
import { ChatIconButton } from './ChatIconButton';
import { getFileName, getFileParentFolder } from '@/services/chat/filePresentation';
import { resolveOutputFilePath } from '@/services/chat/fileOutputPath';
import {
  getFilePreviewKind,
  loadLocalFilePreview,
  loadLocalMarkdownImage,
  resolveLocalFileReference,
  type LocalFilePreview,
} from '@/services/chat/filePreview';
import {
  localManagedFileExists,
  openLocalManagedFile,
  revealLocalManagedFile,
} from '@/services/chat/managedFileRuntime';
import { debugError, debugWarn } from '@/utils/debugLog';
import { ManagedFilePreview } from '@/components/FileExplorer/ManagedFilePreview';

const FILE_ACTION_BUTTON_CLASS = [
  'grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors',
  '[@media(pointer:coarse)]:size-11',
  'hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary',
].join(' ');

async function resolveExistingFilePath(path: string): Promise<string> {
  const candidate = path.trim();
  if (!candidate) return candidate;

  try {
    if (await localManagedFileExists(candidate)) return candidate;
  } catch {
    // keep original candidate when existence check fails
  }
  return candidate;
}

function getFileIconByExt(ext: string): LucideIcon {
  const e = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(e)) return FileImage;
  if (['xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odp', 'ods', 'numbers', 'key'].includes(e)) return FileSpreadsheet;
  if (['md', 'markdown', 'html', 'htm', 'js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'json', 'xml', 'yml', 'yaml', 'sh', 'sql'].includes(e)) return FileCode;
  return FileText; // doc/docx/rtf/txt/pdf/...
}

function FileRow({ file, workspaceRoot }: { file: FileRef; workspaceRoot?: string }) {
  const { t } = useTranslation();
  const addToast = useNotificationStore((s) => s.addToast);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<LocalFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const path = resolveOutputFilePath(file, workspaceRoot);
  const name = getFileName(file.path);
  const detail = [
    file.meta,
    file.kind === 'voice' ? t('resultCards.fileMeta.voice') : null,
    file.isCanonicalOutput === false ? t('resultCards.fileMeta.noncanonical') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const compactDetail = detail || getFileParentFolder(path || file.path);

  const ext = (name.split('.').pop() || '').toLowerCase();
  const isPreviewable = getFilePreviewKind(name) !== null;

  const handleOpen = async () => {
    try {
      if (!path) throw new Error('Output file location is unavailable');
      const openPath = await resolveExistingFilePath(path);
      if (!await openLocalManagedFile(openPath)) throw new Error('Managed file open failed');
    } catch (err) {
      debugError('media', '[FileResultCard] open file failed:', err);
      addToast('info', t('resultCards.open'), t('errors.occurred'));
    }
  };

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(false);
    try {
      if (!path) throw new Error('Output file location is unavailable');
      setPreview(await loadLocalFilePreview(path, name, workspaceRoot));
    } catch (err) {
      debugError('media', '[FileResultCard] preview failed:', err);
      setPreview(null);
      setPreviewError(true);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreview = () => {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(true);
    // Native HTML URLs expire by design. Reissue one when this preview is reopened.
    const refreshInteractiveHtml = preview?.kind === 'html' && preview.mode === 'interactive';
    if (!preview || refreshInteractiveHtml) {
      if (refreshInteractiveHtml) setPreview(null);
      void loadPreview();
    }
  };

  const handleReveal = async () => {
    try {
      if (!path) throw new Error('Output file location is unavailable');
      const revealPath = await resolveExistingFilePath(path);
      if (!await revealLocalManagedFile(revealPath)) throw new Error('Managed file reveal failed');
    } catch (err) {
      debugError('media', '[FileResultCard] reveal file failed:', err);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(path || file.path);
      addToast('info', t('fileManager.copyPathDone'), path || file.path);
    } catch (err) {
      debugWarn('media', '[FileResultCard] copy path failed:', err);
      addToast('info', t('resultCards.path'), t('errors.occurred'));
    }
  };

  const handleOpenMarkdownLink = useCallback(async (href: string) => {
    if (!path) return;
    const resolved = resolveLocalFileReference(href, path, workspaceRoot);
    if (!resolved) return;
    await openLocalManagedFile(resolved);
  }, [path, workspaceRoot]);

  const resolveMarkdownImage = useCallback(
    (source: string) => path
      ? loadLocalMarkdownImage(source, path, workspaceRoot)
      : Promise.resolve(null),
    [path, workspaceRoot],
  );

  const renderPreview = () => {
    if (previewLoading) {
      return (
        <div className="space-y-2 p-3" role="status" aria-label={t('common.loading')}>
          <div className="h-3 w-1/3 animate-pulse rounded-sm bg-[rgb(var(--aegis-overlay)/0.09)]" />
          <div className="h-40 animate-pulse rounded-md bg-[rgb(var(--aegis-overlay)/0.05)]" />
        </div>
      );
    }
    if (!preview || previewError) {
      return (
        <div className="flex items-center justify-between gap-3 px-1 py-2 text-[11px] text-aegis-text-muted" role="status">
          <span className="flex min-w-0 items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-aegis-warning" />
            <span>{t('resultCards.previewReadFailed')}</span>
          </span>
          <ChatIconButton
            label={t('resultCards.retryPreview')}
            className={FILE_ACTION_BUTTON_CLASS}
            onClick={() => void loadPreview()}
          >
            <RefreshCw size={13} />
          </ChatIconButton>
        </div>
      );
    }
    return (
      <ManagedFilePreview
        preview={preview}
        fileName={name}
        compact
        onOpenExternal={() => void handleOpen()}
        onOpenLocalLink={handleOpenMarkdownLink}
        resolveMarkdownImage={resolveMarkdownImage}
      />
    );
  };

  return (
    <div className="rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)]">
      <div
        className={clsx('flex min-h-9 items-center gap-2 px-2.5 py-1.5', isPreviewable && path && 'cursor-pointer')}
        onClick={isPreviewable && path ? handlePreview : undefined}
        onKeyDown={isPreviewable && path ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handlePreview();
          }
        } : undefined}
        role={isPreviewable && path ? 'button' : undefined}
        tabIndex={isPreviewable && path ? 0 : undefined}
        aria-expanded={isPreviewable && path ? previewOpen : undefined}
      >
        {(() => { const Ic = getFileIconByExt(ext); return <Ic size={16} className="shrink-0 text-aegis-primary/80" />; })()}
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5" title={path || file.path}>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-aegis-text">{name}</span>
          {compactDetail && (
            <span className="hidden max-w-[42%] shrink-0 truncate text-[10px] text-aegis-text-dim sm:inline">
              {compactDetail}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5" data-file-actions>
          {isPreviewable && (
            <ChatIconButton
              data-file-action="preview"
              label={previewOpen ? t('resultCards.hidePreview') : t('resultCards.preview')}
              className={clsx(FILE_ACTION_BUTTON_CLASS, previewOpen && 'bg-aegis-primary/10 text-aegis-primary')}
              onClick={(event) => { event.stopPropagation(); handlePreview(); }}
            >
              <PanelRightOpen size={14} />
            </ChatIconButton>
          )}
          <ChatIconButton
            data-file-action="open"
            label={t('resultCards.openExternal')}
            className={FILE_ACTION_BUTTON_CLASS}
            onClick={(event) => { event.stopPropagation(); void handleOpen(); }}
          >
            <ExternalLink size={14} />
          </ChatIconButton>
          <ChatIconButton
            data-file-action="reveal"
            label={t('resultCards.revealInFolder')}
            className={FILE_ACTION_BUTTON_CLASS}
            onClick={(event) => { event.stopPropagation(); void handleReveal(); }}
          >
            <FolderOpen size={14} />
          </ChatIconButton>
          <ChatIconButton
            data-file-action="copy"
            label={t('resultCards.copyPath')}
            className={FILE_ACTION_BUTTON_CLASS}
            onClick={(event) => { event.stopPropagation(); void handleCopy(); }}
          >
            <Copy size={14} />
          </ChatIconButton>
        </div>
      </div>
      {previewOpen && (
        <div className="border-t border-[rgb(var(--aegis-overlay)/0.06)] px-2.5 py-2">
          {renderPreview()}
        </div>
      )}
    </div>
  );
}

export function FileResultCard({ files, workspaceRoot }: { files: FileRef[]; workspaceRoot?: string }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <div className="pl-[42px] py-[3px]">
      <section className="w-full max-w-[760px]" aria-label={t('resultCards.files')}>
        <div className="mb-1 flex h-5 items-center gap-1.5 text-[11px] font-medium text-aegis-text-muted">
          <FolderOpen size={14} className="text-aegis-accent/80" />
          <span>{t('resultCards.files')}</span>
          <span className="text-[10px] text-aegis-text-dim">{files.length}</span>
        </div>
        <div className="space-y-1">
          {files.map((file, index) => <FileRow key={`${file.path}-${index}`} file={file} workspaceRoot={workspaceRoot} />)}
        </div>
      </section>
    </div>
  );
}

export function DecisionCard({ options, onSelect }: { options: DecisionOption[]; onSelect: (value: string) => void }) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <div className="pl-[42px] py-[2px]">
      <div className="rounded-xl border border-aegis-primary/15 bg-aegis-primary/[0.04] px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-aegis-text">
          <Sparkles size={14} className="text-aegis-primary/80" />
          <span>{t('resultCards.nextStep')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {options.map((option, index) => (
            <button
              key={`${option.value}-${index}`}
              onClick={() => onSelect(option.value)}
              className="rounded-full border border-aegis-primary/20 bg-aegis-primary/10 px-3 py-1.5 text-[12px] font-medium text-aegis-primary transition-all hover:border-aegis-primary/35 hover:bg-aegis-primary/20 active:scale-95"
            >
              {option.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const sessionEventTone: Record<SessionEvent['kind'], string> = {
  compaction: 'border-amber-400/20 bg-amber-400/[0.04] text-amber-200',
  fallback: 'border-sky-400/20 bg-sky-400/[0.04] text-sky-200',
  retry: 'border-sky-400/20 bg-sky-400/[0.04] text-sky-200',
  reset: 'border-rose-400/20 bg-rose-400/[0.04] text-rose-200',
  'token-warning': 'border-amber-400/20 bg-amber-400/[0.04] text-amber-200',
  'context-warning': 'border-amber-400/20 bg-amber-400/[0.04] text-amber-200',
  info: 'border-slate-400/20 bg-slate-400/[0.04] text-slate-200',
};

export function SessionEventCard({ event }: { event: SessionEvent }) {
  const { t } = useTranslation();
  // ── Model switch — single-line compact row ──────────────
  // SessionContextBar writes the switch notice as JSON in the event text;
  // try to parse it and render the dedicated compact row. Anything that
  // doesn't look like model-switch JSON falls through to the default pill.
  const trimmed = event.text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed) as { from?: string; to?: string };
      if (data.from && data.to) {
        return (
          <div className="flex justify-center py-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-400/20 bg-slate-400/[0.04] text-[11px]">
              <Layers size={11} className="text-aegis-text-dim" />
              <span className="text-aegis-text-dim">{t('chat.modelSwitched')}</span>
              <span className="font-mono text-aegis-text">{data.from}</span>
              <ArrowsClockwise size={11} weight="bold" className="text-aegis-text-dim" />
              <span className="font-mono text-aegis-text">{data.to}</span>
            </div>
          </div>
        );
      }
    } catch {
      // not JSON, fall through
    }
  }

  return (
    <div className="pl-[42px] py-[2px]">
      <div className={clsx('rounded-xl border px-3 py-2', sessionEventTone[event.kind])}>
        <div className="flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0 opacity-80" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-70">{event.kind.replace('-', ' ')}</div>
            <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">{event.text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkshopEventCard({ events }: { events: WorkshopEvent[] }) {
  const { t } = useTranslation();
  if (events.length === 0) return null;
  return (
    <div className="pl-[42px] py-[2px]">
      <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-aegis-text">
          <Sparkles size={14} className="text-emerald-300/80" />
          <span>{t('resultCards.workshop')}</span>
          <span className="text-[10px] text-aegis-text-dim">{events.length}</span>
        </div>
        <div className="space-y-2">
          {events.map((event, index) => (
            <div
              key={`${event.kind}-${index}`}
              className="rounded-lg border border-emerald-400/10 bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text"
            >
              <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-300/70">{event.kind}</div>
              <div className="whitespace-pre-wrap break-words leading-relaxed">{event.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
