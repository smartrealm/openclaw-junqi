import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Maximize2, Play, Pause, Volume2, VolumeX, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { debugError, debugLog } from '@/utils/debugLog';
import { defaultGatewayHttpUrl } from '@/config/runtimeDefaults';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { saveChatMedia, type MediaSaveResult } from '@/runtime/mediaSaveRuntime';

// ═══════════════════════════════════════════════════════════
// ChatVideo：支持控制、保存和全屏的视频在线播放。
// 支持 HTTP URL、Gateway 媒体路径和本地文件。
// ═══════════════════════════════════════════════════════════

interface ChatVideoProps {
  src: string;
  alt?: string;
  maxWidth?: string;
  maxHeight?: string;
  className?: string;
}

// ── 解析视频来源 ──
function resolveVideoSrc(src: string): string {
  if (!src) return '';

  // 已是 data URL 或 HTTP URL 时直接使用。
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
    return src;
  }

  // aegis-media 协议代表由桌面运行时提供的本地文件。
  if (src.startsWith('aegis-media:')) {
    return src;
  }

  // Gateway 相对媒体路径，例如 /media/xxx.mp4。
  if (src.startsWith('/media/') || src.startsWith('/v1/media/')) {
    const gwUrl = localStorage.getItem('aegis-gateway-http') || defaultGatewayHttpUrl();
    return `${gwUrl}${src}`;
  }

  return src;
}

// ── 从来源提取文件名 ──
function extractFilename(src: string, alt?: string): string {
  if (alt && alt !== 'video' && !alt.startsWith('http')) {
    const sanitized = alt.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
    if (sanitized.match(/\.\w{2,4}$/)) return sanitized;
    return sanitized + '.mp4';
  }

  try {
    const url = new URL(src.startsWith('data:') ? 'file:///video.mp4' : src);
    const pathname = url.pathname;
    const name = pathname.split('/').pop();
    if (name && name.includes('.')) return name;
  } catch { /* 无法解析来源时继续使用默认文件名。 */ }

  return `video-${Date.now()}.mp4`;
}

// ── 通过桌面运行时保存视频 ──
async function saveVideo(src: string, suggestedName: string): Promise<MediaSaveResult> {
  const result = await saveChatMedia(src, suggestedName);
  if (result.success) {
    debugLog('media', '[ChatVideo] Saved to:', result.path);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// ChatVideo 主组件。
// ═══════════════════════════════════════════════════════════

export function ChatVideo({ src, alt, maxWidth = '100%', maxHeight = '400px', className }: ChatVideoProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [, setIsFullscreen] = useState(false);

  const resolvedSrc = resolveVideoSrc(src);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const filename = extractFilename(src, alt);
    setSaveFailed(false);
    void saveVideo(resolvedSrc, filename).then((result) => {
      if (!result.success && !result.canceled) {
        debugError('media', '[ChatVideo] Save failed:', result.error);
        setSaveFailed(true);
      }
    });
  };

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        videoRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    }
  };

  const togglePlayback = () => {
    if (videoRef.current) {
      if (playing) {
        videoRef.current.pause();
      } else {
        void videoRef.current.play();
      }
    }
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePlayback();
  };

  const handleVideoKeyDown = (event: React.KeyboardEvent<HTMLVideoElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    togglePlayback();
  };

  const handleBlur = (event: React.FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setHovered(false);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted(!muted);
    }
  };

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 my-2 rounded-lg bg-aegis-danger/10 px-3 py-2 text-[12px] text-aegis-danger">
        <AlertTriangle size={12} />
        {t('media.videoLoadError')}
      </span>
    );
  }

  return (
    <span
      className={clsx('relative inline-block my-2 group', className)}
      style={{ display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={handleBlur}
    >
      {/* 视频本体支持鼠标与键盘切换播放。 */}
      <video
        ref={videoRef}
        src={resolvedSrc}
        className="cursor-pointer rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] transition-colors duration-[var(--aegis-duration-fast)] hover:border-[rgb(var(--aegis-overlay)/0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
        style={{
          maxWidth,
          maxHeight,
          display: loaded ? 'block' : 'none',
          backgroundColor: 'var(--aegis-bg-frosted-60)'
        }}
        preload="metadata"
        playsInline
        onLoadedMetadata={() => setLoaded(true)}
        onError={() => setError(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
        onKeyDown={handleVideoKeyDown}
        tabIndex={0}
        aria-label={alt || t('media.attachment')}
      />

      {/* 加载占位保持固定尺寸，避免异步媒体改变消息流高度。 */}
      {!loaded && !error && (
        <span
          className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] flex items-center justify-center"
          style={{ display: 'inline-flex', width: 300, height: 170, background: 'rgb(var(--aegis-overlay) / 0.03)' }}
        >
          <LoadingIndicator
            size={20}
            label={t('common.loading')}
            className="text-aegis-text-dim"
          />
        </span>
      )}

      {/* 暂停时显示可聚焦的播放入口。 */}
      {loaded && !playing && (
        <span className="absolute inset-0 flex items-center justify-center" style={{ display: 'flex' }}>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={t('media.play')}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-aegis-border bg-aegis-bg-frosted-60 text-aegis-text backdrop-blur-sm transition-[background-color,color,transform] duration-[var(--aegis-duration-normal)] hover:bg-aegis-bg-frosted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
          >
            <Play size={24} className="text-aegis-text ms-1" fill="currentColor" />
          </button>
        </span>
      )}

      {/* 操作层由悬浮或焦点触发，避免键盘操作时入口消失。 */}
      {loaded && hovered && (
        <span
          className="absolute top-2 right-2 flex items-center gap-1"
          style={{ display: 'inline-flex' }}
        >
          <button
            onClick={toggleMute}
            className="rounded-lg border border-aegis-border bg-aegis-bg-frosted p-1.5 text-aegis-text-secondary backdrop-blur-sm transition-colors duration-[var(--aegis-duration-fast)] hover:bg-aegis-elevated hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
            title={muted ? t('media.unmute') : t('media.muteAudio')}
            aria-label={muted ? t('media.unmute') : t('media.muteAudio')}
          >
            {muted ? (
              <VolumeX size={14} />
            ) : (
              <Volume2 size={14} />
            )}
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg border border-aegis-border bg-aegis-bg-frosted p-1.5 text-aegis-text-secondary backdrop-blur-sm transition-colors duration-[var(--aegis-duration-fast)] hover:bg-aegis-elevated hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
            title={t('media.saveVideo')}
            aria-label={t('media.saveVideo')}
          >
            <Download size={14} />
          </button>
          <button
            onClick={handleFullscreen}
            className="rounded-lg border border-aegis-border bg-aegis-bg-frosted p-1.5 text-aegis-text-secondary backdrop-blur-sm transition-colors duration-[var(--aegis-duration-fast)] hover:bg-aegis-elevated hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 motion-reduce:transition-none"
            title={t('media.fullscreen')}
            aria-label={t('media.fullscreen')}
          >
            <Maximize2 size={14} />
          </button>
        </span>
      )}

      {/* 播放时的底部控制区。 */}
      {loaded && hovered && playing && (
        <span
          className="absolute bottom-2 left-2 right-2 flex items-center gap-2 px-2 py-1 rounded-lg"
          style={{
            display: 'inline-flex',
            background: 'var(--aegis-bg-frosted-60)',
            backdropFilter: 'blur(4px)'
          }}
        >
          <button onClick={togglePlay} aria-label={t('media.pause')} className="rounded p-1 text-aegis-text transition-colors hover:bg-aegis-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50">
            <Pause size={16} />
          </button>
        </span>
      )}

      {/* 替代文本或说明。 */}
      {alt && alt !== 'video' && (
        <span className="text-[11px] text-aegis-text-muted mt-1" style={{ display: 'block' }}>{alt}</span>
      )}
      {saveFailed && (
        <span className="mt-1 block text-[11px] text-aegis-danger" role="status">
          {t('media.saveFailed')}
        </span>
      )}
    </span>
  );
}
