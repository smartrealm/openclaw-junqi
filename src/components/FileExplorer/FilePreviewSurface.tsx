import { lazy, Suspense, type ReactNode } from 'react';
import { ExternalLink, FileWarning, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type { FilePreviewContent } from '@/file-preview/content';
import { formatBytes } from '@/utils/format';
import { formatJsonPreview } from '@/utils/jsonPreview';
import { MarkdownPreview } from './MarkdownPreview';

const PdfPreview = lazy(() =>
  import('./PdfPreview').then((module) => ({ default: module.PdfPreview })),
);

export interface FilePreviewSurfaceProps {
  readonly content: FilePreviewContent;
  readonly fileName: string;
  readonly compact?: boolean;
  readonly onOpenExternal?: () => void;
  readonly onOpenLocalLink?: (href: string) => void | Promise<void>;
  readonly resolveMarkdownImage?: (source: string) => Promise<string | null>;
}

function PreviewNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-[10px] text-aegis-warning">
      <Info size={12} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function FilePreviewSurface({
  content,
  fileName,
  compact = false,
  onOpenExternal,
  onOpenLocalLink,
  resolveMarkdownImage,
}: FilePreviewSurfaceProps) {
  const { t } = useTranslation();
  const boundedHeight = compact ? 'max-h-[min(560px,58vh)]' : 'h-full';
  const truncationNotice = 'truncated' in content && content.truncated ? (
    <PreviewNotice>
      {t('resultCards.previewTruncated', 'This preview is truncated. Open the original file to view everything.')}
    </PreviewNotice>
  ) : null;

  if (content.kind === 'html') {
    return (
      <div className={`flex min-h-0 flex-col ${boundedHeight}`}>
        {content.mode === 'static' && (
          <PreviewNotice>
            {t('resultCards.staticPreviewFallback', 'Interactive resources are unavailable; showing a safe static preview.')}
          </PreviewNotice>
        )}
        <iframe
          src={content.mode === 'interactive' ? content.url : undefined}
          srcDoc={content.mode === 'static' ? content.content : undefined}
          sandbox={content.mode === 'interactive' ? 'allow-scripts' : ''}
          referrerPolicy="no-referrer"
          loading="lazy"
          title={fileName}
          className={`${compact ? 'h-[min(560px,58vh)] min-h-[320px]' : 'min-h-0 flex-1'} w-full border-0 bg-white`}
        />
        {truncationNotice}
      </div>
    );
  }

  if (content.kind === 'image') {
    return (
      <div className={`flex min-h-[220px] items-center justify-center overflow-auto bg-aegis-surface p-3 ${boundedHeight}`}>
        <img
          src={content.url}
          alt={fileName}
          className={compact ? 'max-h-[520px] max-w-full object-contain' : 'max-h-full max-w-full object-contain'}
          draggable={false}
        />
      </div>
    );
  }

  if (content.kind === 'audio') {
    return (
      <div className={`flex items-center justify-center p-6 ${boundedHeight}`}>
        <audio controls src={content.url} className="w-full max-w-xl" />
      </div>
    );
  }

  if (content.kind === 'video') {
    return (
      <div className={`flex min-h-[240px] items-center justify-center bg-black/40 p-3 ${boundedHeight}`}>
        <video controls src={content.url} className="max-h-full max-w-full" />
      </div>
    );
  }

  if (content.kind === 'pdf') {
    return (
      <div className={compact ? 'h-[min(560px,58vh)] min-h-[320px]' : 'h-full'}>
        <Suspense
          fallback={(
            <div className="flex h-full items-center justify-center text-aegis-text-dim">
              <LoadingIndicator
                variant="dots"
                size={10}
                label={t('common.loading', 'Loading...')}
              />
            </div>
          )}
        >
          <PdfPreview
            {...(content.source.kind === 'url'
              ? { url: content.source.url }
              : { base64: content.source.base64 })}
            title={fileName}
            onOpenExternal={onOpenExternal}
          />
        </Suspense>
      </div>
    );
  }

  if (content.kind === 'markdown') {
    return (
      <div className={`min-h-0 overflow-auto ${boundedHeight}`}>
        <MarkdownPreview
          content={content.content}
          className="md-preview"
          onOpenLocalLink={onOpenLocalLink}
          resolveImageSource={resolveMarkdownImage}
        />
        {truncationNotice}
      </div>
    );
  }

  if (content.kind === 'json') {
    const formatted = formatJsonPreview(content.content);
    return (
      <div className={`min-h-0 overflow-auto ${boundedHeight}`}>
        {formatted === null && !content.truncated ? (
          <PreviewNotice>
            {t('file.invalidJsonPreview', 'Invalid JSON. Showing the original content.')}
          </PreviewNotice>
        ) : null}
        {truncationNotice}
        <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-[1.65] text-aegis-text-muted">
          {formatted ?? content.content}
        </pre>
      </div>
    );
  }

  if (content.kind === 'text') {
    return (
      <div className={`min-h-0 overflow-auto ${boundedHeight}`}>
        {truncationNotice}
        <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-[1.65] text-aegis-text-muted">
          {content.content}
        </pre>
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col items-center justify-center gap-3 px-6 text-center text-aegis-text-dim ${boundedHeight}`}>
      <FileWarning size={28} className="opacity-45" />
      <div>
        <p className="text-[12px] font-medium text-aegis-text-muted">
          {t('file.binaryCannotPreview', 'Binary file cannot be previewed')}
        </p>
        {content.byteLength !== undefined && <p className="mt-1 text-[10px]">{formatBytes(content.byteLength)}</p>}
      </div>
      {onOpenExternal && (
        <button
          type="button"
          onClick={onOpenExternal}
          className="flex items-center gap-1.5 rounded border border-aegis-border px-3 py-1.5 text-[11px] text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text"
        >
          <ExternalLink size={12} />
          {t('file.openExternal', 'Open with system app')}
        </button>
      )}
    </div>
  );
}
