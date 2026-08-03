import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, ExternalLink, File, FileImage, FileText, Layers, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSessionArtifacts } from '@/hooks/useSessionArtifacts';
import type { ArtifactDownloadResult, ArtifactSummary } from '@/services/gateway/artifacts';
import { artifactDownloadToPreview, artifactDownloadUrl, artifactInlineLimitBytes } from '@/utils/artifactPreview';
import { ManagedFilePreview } from '@/components/FileExplorer/ManagedFilePreview';

interface SessionArtifactsControlProps {
  sessionKey: string;
  agentId: string;
}

function artifactIcon(artifact: ArtifactSummary) {
  const mime = artifact.mimeType?.toLowerCase() || '';
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return FileText;
  return File;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function triggerDownload(artifact: ArtifactSummary, download: ArtifactDownloadResult): void {
  const url = artifactDownloadUrl(artifact, download);
  if (!url) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.title;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.click();
}

export function SessionArtifactsControl({ sessionKey, agentId }: SessionArtifactsControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    artifacts,
    loading,
    error,
    downloadingId,
    downloads,
    refresh,
    download,
  } = useSessionArtifacts(sessionKey, agentId, open);

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

  const handlePreview = async (artifact: ArtifactSummary) => {
    setSelectedId(artifact.id);
    if (downloads[artifact.id] || artifact.download.mode === 'unsupported') return;
    await download(artifact);
  };

  const handleDownload = async (artifact: ArtifactSummary) => {
    const result = downloads[artifact.id] || await download(artifact);
    if (result) triggerDownload(artifact, result);
  };

  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedId);
  const selectedDownload = selectedArtifact ? downloads[selectedArtifact.id] : undefined;
  const selectedPreview = selectedArtifact && selectedDownload
    ? artifactDownloadToPreview(selectedArtifact, selectedDownload)
    : null;

  return (
    <div ref={rootRef} className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
        title={t('chat.sessionArtifacts.open')}
        aria-label={t('chat.sessionArtifacts.open')}
      >
        <Layers size={11} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.sessionArtifacts.title')}
          className="absolute top-full end-0 z-50 mt-2 flex w-[min(460px,calc(100vw-24px))] max-h-[min(680px,calc(100vh-88px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.sessionArtifacts.title')}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim" title={sessionKey}>{sessionKey}</div>
            </div>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={loading}
              className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
              title={t('chat.sessionArtifacts.refresh')}
              aria-label={t('chat.sessionArtifacts.refresh')}
            >
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && (
              <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-muted" role="status">
                <LoaderCircle size={14} className="animate-spin" />
                <span>{t('chat.sessionArtifacts.loading')}</span>
              </div>
            )}

            {!loading && error && (
              <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-[11px] text-aegis-text-muted">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-aegis-danger" />
                  <span>{t('chat.sessionArtifacts.error')}</span>
                </div>
                <div className="break-words text-[10px] text-aegis-text-dim">{error}</div>
                <button
                  type="button"
                  onClick={() => { void refresh(); }}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
                >
                  {t('chat.sessionArtifacts.retry')}
                </button>
              </div>
            )}

            {!loading && !error && artifacts.length === 0 && (
              <div className="py-6 text-center text-[11px] text-aegis-text-dim">{t('chat.sessionArtifacts.empty')}</div>
            )}

            {!loading && !error && artifacts.length > 0 && (
              <div className="space-y-1.5">
                {artifacts.map((artifact) => {
                  const Icon = artifactIcon(artifact);
                  const isSelected = selectedId === artifact.id;
                  const isDownloading = downloadingId === artifact.id;
                  const isTooLarge = artifact.sizeBytes !== undefined && artifact.sizeBytes > artifactInlineLimitBytes();
                  return (
                    <div key={artifact.id} className="rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)]">
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <Icon size={15} className="shrink-0 text-aegis-primary/80" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-aegis-text" title={artifact.title}>{artifact.title}</div>
                          <div className="mt-0.5 truncate text-[9px] text-aegis-text-dim">
                            {[artifact.type, artifact.mimeType, formatBytes(artifact.sizeBytes)].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {artifact.download.mode !== 'unsupported' && (
                            <button
                              type="button"
                              onClick={() => { void handlePreview(artifact); }}
                              className={clsx('grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text', isSelected && 'bg-aegis-primary/10 text-aegis-primary')}
                              title={t('chat.sessionArtifacts.preview')}
                              aria-label={t('chat.sessionArtifacts.preview')}
                            >
                              {isDownloading ? <LoaderCircle size={13} className="animate-spin" /> : <Layers size={13} />}
                            </button>
                          )}
                          {artifact.download.mode !== 'unsupported' && (
                            <button
                              type="button"
                              onClick={() => { void handleDownload(artifact); }}
                              className="grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text"
                              title={t('chat.sessionArtifacts.download')}
                              aria-label={t('chat.sessionArtifacts.download')}
                            >
                              <Download size={13} />
                            </button>
                          )}
                          {artifact.download.mode === 'unsupported' && (
                            <span className="px-1 text-[9px] text-aegis-text-dim">{t('chat.sessionArtifacts.unsupported')}</span>
                          )}
                        </div>
                      </div>

                      {isSelected && selectedArtifact?.id === artifact.id && (
                        <div className="border-t border-aegis-border px-2.5 py-2">
                          {isTooLarge && <div className="text-[10px] text-aegis-text-muted">{t('chat.sessionArtifacts.tooLarge')}</div>}
                          {!isTooLarge && selectedPreview && (
                            <ManagedFilePreview preview={selectedPreview} fileName={artifact.title} compact />
                          )}
                          {!isTooLarge && selectedDownload && !selectedPreview && (
                            <div className="flex items-center justify-between gap-2 text-[10px] text-aegis-text-muted">
                              <span>{t('chat.sessionArtifacts.externalOnly')}</span>
                              {'url' in selectedDownload && (
                                <button
                                  type="button"
                                  onClick={() => window.open(selectedDownload.url, '_blank', 'noopener,noreferrer')}
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-aegis-primary hover:bg-aegis-primary/10"
                                >
                                  <ExternalLink size={12} />
                                  {t('chat.sessionArtifacts.openExternal')}
                                </button>
                              )}
                            </div>
                          )}
                          {!selectedDownload && !isDownloading && artifact.download.mode !== 'unsupported' && (
                            <div className="text-[10px] text-aegis-text-dim">{t('chat.sessionArtifacts.previewUnavailable')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
