// PDF 预览使用 pdfjs-dist 的画布渲染，不依赖原生插件。
// 接收原始 base64 数据，以满足桌面 WebView 的内容安全策略。

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.min.mjs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ExternalLink, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { releasePdfDocument } from './pdfDocumentLifecycle';

// 直接使用上游 Worker，避免维护自定义桥接层。
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

type PdfPreviewProps =
  | {
      /** Raw PDF data as base64 string. */
      base64: string;
      url?: never;
      title?: string;
      onOpenExternal?: () => void;
    }
  | {
      /** Scoped native preview URL for files outside a workspace IPC root. */
      url: string;
      base64?: never;
      title?: string;
      onOpenExternal?: () => void;
    };

const SCALE_STEP = 0.25;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;
const SCALE_DEFAULT = 1.2;

export function PdfPreview(props: PdfPreviewProps) {
  if (typeof props.url === 'string') {
    return <NativePdfPreview url={props.url} title={props.title} onOpenExternal={props.onOpenExternal} />;
  }
  if (typeof props.base64 !== 'string') return null;
  return <CanvasPdfPreview base64={props.base64} onOpenExternal={props.onOpenExternal} />;
}

function NativePdfPreview({
  url,
  title = 'PDF',
  onOpenExternal,
}: {
  url: string;
  title?: string;
  onOpenExternal?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col bg-[rgb(var(--aegis-overlay)/0.03)]">
      {onOpenExternal && (
        <div className="flex h-9 shrink-0 items-center justify-end border-b border-[rgb(var(--aegis-overlay)/0.06)] px-2">
          <button
            type="button"
            onClick={onOpenExternal}
            className="flex items-center gap-1.5 rounded border border-[rgb(var(--aegis-overlay)/0.1)] px-2.5 py-1 text-[11px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
          >
            <ExternalLink size={12} />
            {t('file.openExternal', 'Open with system app')}
          </button>
        </div>
      )}
      <iframe
        title={title}
        src={url}
        sandbox=""
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}

function CanvasPdfPreview({ base64, onOpenExternal }: { base64: string; onOpenExternal?: () => void }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const loadVersionRef = useRef(0);
  const renderVersionRef = useRef(0);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(SCALE_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [renderLoading, setRenderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useNativePreview, setUseNativePreview] = useState(false);
  const nativePdfSrc = useMemo(() => `data:application/pdf;base64,${base64}`, [base64]);

  useEffect(() => {
    const loadVersion = ++loadVersionRef.current;
    let disposed = false;
    setLoading(true);
    setError(null);
    setPage(1);
    setDoc(null);
    setUseNativePreview(false);

    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      loadingTask = pdfjs.getDocument({
        data: bytes,
        // 桌面生成的 PDF 出现局部错误时仍尽量呈现可读取页面。
        stopAtErrors: false,
      });
      loadingTask.promise
        .then((pdf) => {
          if (disposed || loadVersion !== loadVersionRef.current) {
            void releasePdfDocument(pdf);
            return;
          }
          setDoc(pdf);
          setNumPages(pdf.numPages);
          setLoading(false);
        })
        .catch((err) => {
          if (disposed || loadVersion !== loadVersionRef.current) return;
          const message = err?.message || 'Failed to load PDF';
          if (/toHex is not a function/i.test(message)) {
            setUseNativePreview(true);
            setError(null);
            setLoading(false);
            return;
          }
          setError(message);
          setLoading(false);
        });
    } catch (err: any) {
      if (disposed || loadVersion !== loadVersionRef.current) return;
      const message = err?.message || 'Failed to decode PDF';
      if (/toHex is not a function/i.test(message)) {
        setUseNativePreview(true);
        setError(null);
        setLoading(false);
        return;
      }
      setError(message);
      setLoading(false);
    }

    return () => {
      disposed = true;
      loadingTask?.destroy().catch(() => {});
    };
  }, [base64]);

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, pageNum: number, pageScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch {}
      renderTaskRef.current = null;
    }

    setRenderLoading(true);
    const renderVersion = ++renderVersionRef.current;
    let pdfPage: PDFPageProxy | null = null;
    try {
      pdfPage = await pdf.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: pageScale });
      const devicePixelRatio = window.devicePixelRatio || 1;
      canvas.width = viewport.width * devicePixelRatio;
      canvas.height = viewport.height * devicePixelRatio;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);

      const task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        const message = err?.message || 'Failed to render PDF page';
        if (/toHex is not a function/i.test(message)) {
          setUseNativePreview(true);
          setError(null);
          return;
        }
        setError(message);
      }
    } finally {
      pdfPage?.cleanup();
      if (renderVersion === renderVersionRef.current) {
        setRenderLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!doc) return;
    renderPage(doc, page, scale);
  }, [doc, page, scale, renderPage]);

  // 加载任务已在上方中止；文档实例仍需单独清理其已加载的 Worker 侧资源。
  useEffect(() => () => {
    if (doc) void releasePdfDocument(doc);
  }, [doc]);

  useEffect(() => {
    return () => {
      try {
        renderTaskRef.current?.cancel();
      } catch {}
      renderTaskRef.current = null;
    };
  }, []);

  const prevPage = () => setPage((p) => Math.max(1, p - 1));
  const nextPage = () => setPage((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(SCALE_MAX, +(s + SCALE_STEP).toFixed(2)));
  const zoomOut = () => setScale((s) => Math.max(SCALE_MIN, +(s - SCALE_STEP).toFixed(2)));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingIndicator
          variant="dots"
          size={12}
          label={t('common.loading', 'Loading...')}
          className="text-aegis-primary"
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <AlertCircle size={28} className="text-red-400/60" />
        <div className="text-[12px] text-aegis-text-dim">{error}</div>
        {onOpenExternal && (
          <button
            onClick={onOpenExternal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)] text-[11px] text-aegis-text-muted hover:text-aegis-text transition-colors"
          >
            <ExternalLink size={12} />
            {t('file.openExternal', 'Open with system app')}
          </button>
        )}
      </div>
    );
  }

  if (useNativePreview) {
    return (
      <div className="h-full bg-[rgb(var(--aegis-overlay)/0.03)] p-2 flex flex-col gap-2">
        <div className="text-[11px] text-aegis-text-dim px-1">
          {t('file.openExternal', 'Open with system app')} PDF
        </div>
        <iframe
          title="pdf-native-preview"
          src={nativePdfSrc}
          className="w-full flex-1 rounded border border-[rgb(var(--aegis-overlay)/0.08)] bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.02)]">
        <button onClick={prevPage} disabled={page <= 1} className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-30 transition-colors">
          <ChevronLeft size={14} className="text-aegis-text-muted" />
        </button>
        <span className="text-[11px] text-aegis-text-dim tabular-nums">
          {page} / {numPages}
        </span>
        <button onClick={nextPage} disabled={page >= numPages} className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-30 transition-colors">
          <ChevronRight size={14} className="text-aegis-text-muted" />
        </button>

        <div className="w-px h-4 bg-[rgb(var(--aegis-overlay)/0.1)] mx-1" />

        <button onClick={zoomOut} disabled={scale <= SCALE_MIN} className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-30 transition-colors">
          <ZoomOut size={13} className="text-aegis-text-muted" />
        </button>
        <span className="text-[11px] text-aegis-text-dim tabular-nums w-10 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={zoomIn} disabled={scale >= SCALE_MAX} className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-30 transition-colors">
          <ZoomIn size={13} className="text-aegis-text-muted" />
        </button>

        <div className="flex-1" />

        {renderLoading && (
          <LoadingIndicator
            size={12}
            label={t('common.loading', 'Loading...')}
            className="text-aegis-text-dim"
          />
        )}

        {onOpenExternal && (
          <button
            onClick={onOpenExternal}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-[11px] text-aegis-text-dim hover:text-aegis-text transition-colors"
          >
            <ExternalLink size={11} />
            {t('file.openExternal', 'Open with system app')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto bg-[rgb(var(--aegis-overlay)/0.03)] flex justify-center p-4">
        <canvas
          ref={canvasRef}
          className="shadow-lg rounded"
          style={{ display: 'block', maxWidth: '100%' }}
        />
      </div>
    </div>
  );
}
