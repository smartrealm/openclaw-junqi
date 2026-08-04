import { lazy, Suspense, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type { ManagedFilePreview as ManagedFilePreviewValue } from '@/utils/filePreviewCapabilities';
import { formatJsonPreview } from '@/utils/jsonPreview';
import { MarkdownPreview } from './MarkdownPreview';

const PdfPreview = lazy(() =>
  import('./PdfPreview').then((module) => ({ default: module.PdfPreview })),
);

export interface ManagedFilePreviewProps {
  preview: ManagedFilePreviewValue;
  fileName: string;
  compact?: boolean;
  onOpenExternal?: () => void;
  onOpenLocalLink?: (href: string) => void | Promise<void>;
  resolveMarkdownImage?: (source: string) => Promise<string | null>;
}

function PreviewNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-[10px] text-aegis-warning">
      <Info size={12} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function ManagedFilePreview({
  preview,
  fileName,
  compact = false,
  onOpenExternal,
  onOpenLocalLink,
  resolveMarkdownImage,
}: ManagedFilePreviewProps) {
  const { t } = useTranslation();
  const boundedHeight = compact ? 'max-h-[min(560px,58vh)]' : 'h-full';
  const truncationNotice = 'truncated' in preview && preview.truncated ? (
    <PreviewNotice>
      {t('resultCards.previewTruncated', 'This preview is truncated. Open the original file to view everything.')}
    </PreviewNotice>
  ) : null;

  if (preview.kind === 'html') {
    return (
      <div className={`flex min-h-0 flex-col ${boundedHeight}`}>
        {preview.mode === 'static' && (
          <PreviewNotice>
            {t('resultCards.staticPreviewFallback', 'Interactive resources are unavailable; showing a safe static preview.')}
          </PreviewNotice>
        )}
        <iframe
          src={preview.mode === 'interactive' ? preview.url : undefined}
          srcDoc={preview.mode === 'static' ? preview.content : undefined}
          sandbox={preview.mode === 'interactive' ? 'allow-scripts' : ''}
          referrerPolicy="no-referrer"
          loading="lazy"
          title={fileName}
          className={`${compact ? 'h-[min(560px,58vh)] min-h-[320px]' : 'min-h-0 flex-1'} w-full border-0 bg-white`}
        />
        {truncationNotice}
      </div>
    );
  }

  if (preview.kind === 'image') {
    return (
      <div className={`flex min-h-[220px] items-center justify-center overflow-auto bg-[rgb(var(--aegis-overlay)/0.03)] p-3 ${boundedHeight}`}>
        <img
          src={preview.url}
          alt={fileName}
          className={compact ? 'max-h-[520px] max-w-full object-contain' : 'max-h-full max-w-full object-contain'}
          draggable={false}
        />
      </div>
    );
  }

  if (preview.kind === 'audio') {
    return (
      <div className={`flex items-center justify-center p-6 ${boundedHeight}`}>
        <audio controls src={preview.url} className="w-full max-w-xl" />
      </div>
    );
  }

  if (preview.kind === 'video') {
    return (
      <div className={`flex min-h-[240px] items-center justify-center bg-black/40 p-3 ${boundedHeight}`}>
        <video controls src={preview.url} className="max-h-full max-w-full" />
      </div>
    );
  }

  if (preview.kind === 'pdf') {
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
            url={preview.url}
            title={fileName}
            onOpenExternal={onOpenExternal}
          />
        </Suspense>
      </div>
    );
  }

  if (preview.kind === 'markdown') {
    return (
      <div className={`min-h-0 overflow-auto ${boundedHeight}`}>
        <MarkdownPreview
          content={preview.content}
          className="md-preview"
          onOpenLocalLink={onOpenLocalLink}
          resolveImageSource={resolveMarkdownImage}
        />
        {truncationNotice}
      </div>
    );
  }

  if (preview.kind === 'json') {
    const formatted = formatJsonPreview(preview.content);
    return (
      <div className={`min-h-0 overflow-auto ${boundedHeight}`}>
        {formatted === null && !preview.truncated ? (
          <PreviewNotice>
            {t('file.invalidJsonPreview', 'Invalid JSON. Showing the original content.')}
          </PreviewNotice>
        ) : null}
        {truncationNotice}
        <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-[1.65] text-aegis-text-muted">
          {formatted ?? preview.content}
        </pre>
      </div>
    );
  }

  if (!('content' in preview)) return null;

  return (
    <div className={`min-h-0 overflow-auto ${boundedHeight}`}>
      {truncationNotice}
      <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-[1.65] text-aegis-text-muted">
        {preview.content}
      </pre>
    </div>
  );
}
