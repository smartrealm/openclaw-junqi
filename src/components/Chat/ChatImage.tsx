import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download, Maximize2, X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import { debugError, debugLog } from '@/utils/debugLog';
import { defaultGatewayHttpUrl } from '@/config/runtimeDefaults';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveOpenClawMediaPreviewUrl } from '@/runtime/openClawMediaPreview';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { saveChatMedia } from '@/runtime/mediaSaveRuntime';

// ═══════════════════════════════════════════════════════════
// ChatImage：支持保存、缩放和灯箱查看的图片展示。
// 支持 base64、HTTP URL 和 Gateway 媒体路径。
// ═══════════════════════════════════════════════════════════

interface ChatImageProps {
  src: string;
  alt?: string;
  maxWidth?: string;
  maxHeight?: string;
  className?: string;
}

interface ImageSaveResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export function classifyImageSaveResult(result: ImageSaveResult | null | undefined): 'saved' | 'cancelled' | 'failed' {
  if (result?.success) return 'saved';
  if (result?.canceled || /^(?:cancelled|canceled)$/i.test(result?.error?.trim() ?? '')) return 'cancelled';
  return 'failed';
}

// ── 解析图片来源 ──
// 处理 OpenClaw 与 Gateway 返回的不同来源格式。
// 需要异步 IPC 解析的 aegis-media 路径返回 null。
function resolveImageSrcSync(src: string): string | null {
  if (!src) return '';

  // 已是 data URL 或 HTTP URL 时直接使用。
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
    return src;
  }

  // aegis-media 本地路径需要异步 IPC 解析。
  if (src.startsWith('aegis-media:')) {
    return null;
  }

  // Gateway 相对媒体路径，例如 /media/xxx.png。
  if (src.startsWith('/media/') || src.startsWith('/v1/media/')) {
    // 基于 Gateway URL 解析，来源为配置或本地默认地址。
    const gwUrl = localStorage.getItem('aegis-gateway-http') || defaultGatewayHttpUrl();
    return `${gwUrl}${src}`;
  }

  return src;
}

/** 通过原生受限预览桥接解析已持久化的 OpenClaw 媒体。 */
function useResolvedImageSrc(src: string): string {
  const syncResolved = useMemo(() => resolveImageSrcSync(src), [src]);
  const [asyncSrc, setAsyncSrc] = useState<string>('');

  useEffect(() => {
    if (syncResolved !== null) return;
    if (!src.startsWith('aegis-media:')) return;

    let disposed = false;
    setAsyncSrc('');

    void (async () => {
      const previewUrl = await resolveOpenClawMediaPreviewUrl(src);
      if (disposed) return;
      if (previewUrl) {
        setAsyncSrc(previewUrl);
        return;
      }

      debugError('media', '[ChatImage] OpenClaw media preview was unavailable');
    })().catch((error: unknown) => {
      if (!disposed) debugError('media', '[ChatImage] OpenClaw media preview failed', error);
    });

    return () => {
      disposed = true;
    };
  }, [src, syncResolved]);

  return syncResolved !== null ? syncResolved : asyncSrc;
}

// ── 从来源提取文件名 ──
function extractFilename(src: string, alt?: string): string {
  if (alt && alt !== 'image' && alt !== 'attachment' && !alt.startsWith('http')) {
    // 使用清理后的替代文本作为文件名。
    const sanitized = alt.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
    if (sanitized.match(/\.\w{2,4}$/)) return sanitized;
    return sanitized + '.png';
  }

  try {
    const url = new URL(src.startsWith('data:') ? 'file:///image.png' : src);
    const pathname = url.pathname;
    const name = pathname.split('/').pop();
    if (name && name.includes('.')) return name;
  } catch { /* 无法解析来源时继续使用默认文件名。 */ }

  return `image-${Date.now()}.png`;
}

// ── 通过桌面运行时保存图片 ──
async function saveImage(src: string, suggestedName: string): Promise<ImageSaveResult> {
  const result = await saveChatMedia(src, suggestedName);
  if (classifyImageSaveResult(result) === 'saved') {
    debugLog('media', '[ChatImage] Saved to:', result.path);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// 灯箱全屏图片查看器。
// ═══════════════════════════════════════════════════════════

interface LightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: LightboxProps) {
  const { t } = useTranslation();
  const uiScale = useSettingsStore((state) => state.uiScale);
  const topBarHeight = useMemo(() => {
    if (typeof document === 'undefined') return 0;
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--aegis-topbar-h'),
    );
    return Number.isFinite(value) ? value : 0;
  }, []);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  // Escape 关闭灯箱。
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 5));
      if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.25));
      if (e.key === '0') { setZoom(1); setOffset({ x: 0, y: 0 }); setRotation(0); }
      if (e.key === 'r' || e.key === 'R') setRotation(r => r + 90);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // 鼠标滚轮缩放。
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom(z => Math.min(Math.max(z + delta, 0.25), 5));
  }, []);

  // 拖拽平移。
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    });
  };

  const handleMouseUp = () => setDragging(false);

  const handleSave = () => {
    const filename = extractFilename(src, alt);
    saveImage(resolveImageSrcSync(src) ?? src, filename);
  };

  const lightbox = (
    <div
      className="fixed inset-x-0 bottom-0 z-[9999] flex items-center justify-center"
      style={{
        top: `${topBarHeight * (100 / Math.max(1, uiScale))}px`,
        background: 'var(--aegis-bg-frosted)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={handleWheel}
      role="dialog"
      aria-modal="true"
      aria-label={alt || t('media.attachment')}
    >
      {/* 顶部操作栏使用主题半透明表面，确保所有主题下都有稳定对比度。 */}
      <div className="absolute top-0 left-0 right-0 z-10 flex h-12 items-center justify-between border-b border-aegis-border/50 bg-aegis-bg-frosted-60 px-4 backdrop-blur-sm">
        <span className="text-[12px] text-aegis-text-muted font-mono">
          {alt || t('media.attachment')} - {Math.round(zoom * 100)}%
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.min(z + 0.25, 5))}
            className="rounded-lg p-2 text-aegis-text-secondary transition-colors duration-[var(--aegis-duration-fast)] hover:bg-[rgb(var(--aegis-overlay)/0.1)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none" title={t('media.zoomIn')} aria-label={t('media.zoomIn')}>
            <ZoomIn size={16} />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}
            className="rounded-lg p-2 text-aegis-text-secondary transition-colors duration-[var(--aegis-duration-fast)] hover:bg-[rgb(var(--aegis-overlay)/0.1)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none" title={t('media.zoomOut')} aria-label={t('media.zoomOut')}>
            <ZoomOut size={16} />
          </button>
          <button onClick={() => setRotation(r => r + 90)}
            className="rounded-lg p-2 text-aegis-text-secondary transition-colors duration-[var(--aegis-duration-fast)] hover:bg-[rgb(var(--aegis-overlay)/0.1)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none" title={t('media.rotate')} aria-label={t('media.rotate')}>
            <RotateCw size={16} />
          </button>
          <div className="w-px h-5 bg-[rgb(var(--aegis-overlay)/0.1)] mx-1" />
          <button onClick={handleSave}
            className="rounded-lg p-2 text-aegis-text-secondary transition-colors duration-[var(--aegis-duration-fast)] hover:bg-[rgb(var(--aegis-overlay)/0.1)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none" title={t('media.save')} aria-label={t('media.save')}>
            <Download size={16} />
          </button>
          <div className="w-px h-5 bg-[rgb(var(--aegis-overlay)/0.1)] mx-1" />
          <button onClick={onClose}
            className="rounded-lg p-2 text-aegis-text-secondary transition-colors duration-[var(--aegis-duration-fast)] hover:bg-[rgb(var(--aegis-overlay)/0.1)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none" title={t('media.closeEsc')} aria-label={t('media.closeEsc')}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 图像缩放仅作用于媒体本身，拖拽中立即跟随指针。 */}
      <img
        src={resolveImageSrcSync(src) ?? src}
        alt={alt || ''}
        draggable={false}
        className="select-none transition-transform"
        style={{
          maxWidth: zoom === 1 ? '90vw' : 'none',
          maxHeight: zoom === 1 ? '85vh' : 'none',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
          transitionDuration: dragging ? '0ms' : '200ms',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* 底部说明。 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-aegis-text-dim select-none">
        {t('media.imageControls')}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? lightbox : createPortal(lightbox, document.body);
}

// ═══════════════════════════════════════════════════════════
// ChatImage 主组件。
// ═══════════════════════════════════════════════════════════

export function ChatImage({ src, alt, maxWidth = '100%', maxHeight = '400px', className }: ChatImageProps) {
  const { t } = useTranslation();
  const [showLightbox, setShowLightbox] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const resolvedSrc = useResolvedImageSrc(src);

  // 来源变化时重置加载与错误状态，例如异步 IPC 结果到达。
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [resolvedSrc]);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const filename = extractFilename(src, alt);
    setSaveFailed(false);
    void saveImage(resolvedSrc, filename).then((result) => {
      const outcome = classifyImageSaveResult(result);
      if (outcome === 'failed') {
        debugError('media', '[ChatImage] Save failed:', result.error);
        setSaveFailed(true);
      }
    });
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowLightbox(true);
  };

  const handleImageKeyDown = (event: React.KeyboardEvent<HTMLImageElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setShowLightbox(true);
  };

  const handleBlur = (event: React.FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setHovered(false);
    }
  };

  if (error) return null;

  // 使用 span 包装，允许 ReactMarkdown 将其嵌入段落。
  return (
    <>
      <span
        className={clsx('relative inline-block my-2 group', className)}
        style={{ display: 'inline-block' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={handleBlur}
      >
        {/* 已加载图片支持鼠标与键盘进入同一组操作。 */}
        <img
          src={resolvedSrc}
          alt={alt || ''}
          className="cursor-pointer rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] transition-colors duration-[var(--aegis-duration-fast)] hover:border-[rgb(var(--aegis-overlay)/0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
          style={{ maxWidth, maxHeight, display: loaded ? 'block' : 'none' }}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onClick={handleExpand}
          onKeyDown={handleImageKeyDown}
          tabIndex={0}
          aria-label={alt || t('media.zoom')}
        />

        {/* 加载占位保持固定尺寸，避免异步媒体改变消息流高度。 */}
        {!loaded && !error && (
          <span className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] flex items-center justify-center"
            style={{ display: 'inline-flex', width: 200, height: 150, background: 'rgb(var(--aegis-overlay) / 0.03)' }}>
            <LoadingIndicator
              size={20}
              label={t('common.loading')}
              className="text-aegis-text-dim"
            />
          </span>
        )}

        {/* 操作层由悬浮或焦点触发，避免键盘操作时入口消失。 */}
        {loaded && hovered && (
          <span className="absolute right-2 top-2 flex items-center gap-1" style={{ display: 'inline-flex' }}>
            <button
              onClick={handleSave}
              className="rounded-lg border border-aegis-border bg-aegis-bg-frosted p-1.5 text-aegis-text-secondary backdrop-blur-sm transition-colors duration-[var(--aegis-duration-fast)] hover:bg-aegis-elevated hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
              title={t('media.saveImage')}
              aria-label={t('media.saveImage')}
            >
              <Download size={14} />
            </button>
            <button
              onClick={handleExpand}
              className="rounded-lg border border-aegis-border bg-aegis-bg-frosted p-1.5 text-aegis-text-secondary backdrop-blur-sm transition-colors duration-[var(--aegis-duration-fast)] hover:bg-aegis-elevated hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
              title={t('media.zoom')}
              aria-label={t('media.zoom')}
            >
              <Maximize2 size={14} />
            </button>
          </span>
        )}

        {/* 替代文本。 */}
        {alt && alt !== 'image' && alt !== t('media.attachment') && (
          <span className="text-[11px] text-aegis-text-muted mt-1" style={{ display: 'block' }}>{alt}</span>
        )}
        {saveFailed && (
          <span className="mt-1 block text-[11px] text-aegis-danger" role="status">
            {t('media.saveFailed')}
          </span>
        )}
      </span>

      {/* 灯箱。 */}
      {showLightbox && (
        <ImageLightbox
          src={resolvedSrc}
          alt={alt}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </>
  );
}
