import { lazy, Suspense, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { debugError } from '@/utils/debugLog';
import { Icon } from '@/components/shared/icons';
import { fileExtension, workspaceFileKind } from '@/workspace-files/domain/fileKinds';

const CodeBlock = lazy(() => import('./CodeBlock').then((module) => ({ default: module.CodeBlock })));
const ChatImage = lazy(() => import('./ChatImage').then((module) => ({ default: module.ChatImage })));
const ChatVideo = lazy(() => import('./ChatVideo').then((module) => ({ default: module.ChatVideo })));

const VIDEO_SOURCE_PATTERN = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
const FILE_MARKER_PATTERN = new RegExp('^\\u{1F4CE}\\s*file:\\s*(.+?)(?:\\s*\\(([^)]+)\\))?\\s*$', 'u');
const VOICE_MARKER_PATTERN = new RegExp('^\\u{1F3A4}\\s*\\[voice\\]\\s*(.+?)(?:\\s*\\(([^)]+)\\))?\\s*$', 'u');

interface ChatMarkdownRendererProps {
  markdown: string;
}

export function ChatMediaFallback({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'flex items-center justify-center rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] text-[11px] text-aegis-text-dim animate-pulse',
        className,
      )}
    >
      ...
    </div>
  );
}

function CodeBlockFallback({ language, code }: { language: string; code: string }) {
  const displayLanguage = language || 'text';
  return (
    <div
      className="my-2 overflow-hidden rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)]"
      dir="ltr"
      style={{ background: 'var(--aegis-code-bg)' }}
    >
      <div
        className="flex items-center justify-between border-b border-[rgb(var(--aegis-overlay)/0.06)] px-3.5 py-1.5"
        style={{ background: 'var(--aegis-code-header)' }}
      >
        <span className="text-[10px] font-mono font-medium uppercase tracking-widest text-aegis-text-muted">
          {displayLanguage}
        </span>
      </div>
      <pre
        className="m-0 overflow-x-auto break-words whitespace-pre-wrap bg-[var(--aegis-code-bg)] p-4 font-mono text-[0.87em] text-aegis-text"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isLocalFilePath(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return Boolean(
    trimmed
      && (trimmed.startsWith('/')
        || trimmed.startsWith('~/')
        || /^[A-Za-z]:[\\/]/.test(trimmed)
        || trimmed.startsWith('file://')),
  );
}

function singleTextChild(children: ReactNode): string | undefined {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') {
    return children[0];
  }
  return undefined;
}

function childrenText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (!Array.isArray(children)) return '';
  return children.map(childrenText).join('');
}

const FILE_CARD_META_KEYS = {
  attachment: 'resultCards.fileMeta.attachment',
  media: 'resultCards.fileMeta.media',
  voice: 'resultCards.fileMeta.voice',
  file: 'resultCards.fileMeta.file',
} as const;

type FileCardFallbackMeta = keyof typeof FILE_CARD_META_KEYS;

function FileCard({
  path,
  meta,
  fallbackMeta,
}: {
  path: string;
  meta?: string;
  fallbackMeta?: FileCardFallbackMeta;
}) {
  const { t } = useTranslation();
  const displayMeta = meta || (fallbackMeta
    ? t(FILE_CARD_META_KEYS[fallbackMeta])
    : t('resultCards.open'));
  const name = path.split(/[/\\]/).pop() || path;
  const extension = fileExtension(name);
  const kind = workspaceFileKind(name);
  const fileIcon = (() => {
    if (kind === 'image') return Icon.chat.attachment.image;
    if (kind === 'audio') return Icon.chat.attachment.audio;
    if (kind === 'video') return Icon.chat.attachment.video;
    if (kind === 'code') {
      return ['json', 'jsonc', 'yaml', 'yml', 'toml', 'xml'].includes(extension)
        ? Icon.chat.attachment.config
        : Icon.chat.attachment.code;
    }
    if (kind === 'markdown' || kind === 'text' || kind === 'pdf' || kind === 'html') {
      return Icon.chat.attachment.document;
    }
    return Icon.chat.attachment.generic;
  })();

  const handleOpen = async () => {
    try {
      const openManagedPath = window.aegis?.managedFiles?.open || window.aegis?.uploads?.open;
      if (openManagedPath) {
        await openManagedPath(path);
        return;
      }
      const url = path.startsWith('file://') ? path : `file://${path}`;
      window.open(url, '_blank');
    } catch (error) {
      debugError('media', '[ChatMarkdownRenderer] Failed to open file path:', error);
    }
  };

  const copyPath = () => {
    void navigator.clipboard.writeText(path).catch(() => undefined);
  };

  return (
    <div
      onClick={handleOpen}
      title={path}
      className="group/filecard relative my-1 inline-flex max-w-full cursor-pointer items-center gap-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.05)] px-3 py-1.5 text-start transition-colors hover:border-aegis-primary/20"
    >
      <span className="flex shrink-0 items-center">{fileIcon}</span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] font-medium text-aegis-text">{name}</span>
        <span className="truncate text-[10px] text-aegis-text-dim">{displayMeta}</span>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          copyPath();
        }}
        className="absolute right-0.5 top-0.5 rounded-md p-1 text-aegis-text-muted opacity-0 transition-all hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary group-hover/filecard:opacity-100"
        title={t('resultCards.copyPath')}
        aria-label={t('resultCards.copyPath')}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}

async function openExternalHref(href: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(href);
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

function desktopUrlTransform(url: string): string {
  return isLocalFilePath(url) ? url : defaultUrlTransform(url);
}

const markdownComponents: Components = {
  table({ children }) {
    return <div className="table-wrapper"><table>{children}</table></div>;
  },
  code({ className, children, node: _node, ...props }) {
    const languageMatch = /language-(\w+)/.exec(className || '');
    const code = childrenText(children).replace(/\n$/, '');
    if (languageMatch || code.includes('\n')) {
      const language = languageMatch?.[1] || '';
      return (
        <Suspense fallback={<CodeBlockFallback language={language} code={code} />}>
          <CodeBlock language={language} code={code} />
        </Suspense>
      );
    }
    return (
      <code
        className="rounded px-1.5 py-0.5 font-mono text-[13px]"
        style={{ background: 'rgb(var(--aegis-primary) / 0.12)', color: 'rgb(var(--aegis-primary))' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  img({ src, alt }) {
    const imageSource = typeof src === 'string' ? src : '';
    if (!imageSource) return null;
    if (VIDEO_SOURCE_PATTERN.test(imageSource)) {
      return (
        <Suspense fallback={<ChatMediaFallback className="h-[220px] w-full max-w-[400px]" />}>
          <ChatVideo src={imageSource} alt={alt} maxWidth="100%" maxHeight="400px" />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<ChatMediaFallback className="h-[220px] w-full max-w-[400px]" />}>
        <ChatImage src={imageSource} alt={alt} maxWidth="100%" maxHeight="400px" />
      </Suspense>
    );
  },
  p({ children }) {
    const text = singleTextChild(children);
    if (text) {
      const fileMatch = text.match(FILE_MARKER_PATTERN);
      if (fileMatch) return <FileCard path={fileMatch[1].trim()} meta={fileMatch[2]?.trim()} />;
      const attachedFileMatch = text.match(/^\[file attached:\s*(.+?)\]\s*$/i);
      if (attachedFileMatch) return <FileCard path={attachedFileMatch[1].trim()} fallbackMeta="attachment" />;
      const attachedMediaMatch = text.match(/^\[media attached:\s*(.+?)\]\s*$/i);
      if (attachedMediaMatch) return <FileCard path={attachedMediaMatch[1].trim()} fallbackMeta="media" />;
      const voiceMatch = text.match(VOICE_MARKER_PATTERN);
      if (voiceMatch) return <FileCard path={voiceMatch[1].trim()} meta={voiceMatch[2]?.trim()} fallbackMeta="voice" />;
    }
    return <p>{children}</p>;
  },
  a({ href, children }) {
    const linkHref = typeof href === 'string' ? href : undefined;
    if (linkHref && isLocalFilePath(linkHref)) {
      return <FileCard path={linkHref} meta={childrenText(children)} fallbackMeta="file" />;
    }
    if (linkHref && VIDEO_SOURCE_PATTERN.test(linkHref)) {
      return (
        <Suspense fallback={<ChatMediaFallback className="h-[220px] w-full max-w-[400px]" />}>
          <ChatVideo src={linkHref} alt={childrenText(children) || 'video'} maxWidth="100%" maxHeight="400px" />
        </Suspense>
      );
    }
    return (
      <a
        href={linkHref}
        onClick={async (event) => {
          event.preventDefault();
          if (!linkHref) return;
          const openManagedPath = window.aegis?.managedFiles?.open || window.aegis?.uploads?.open;
          if (isLocalFilePath(linkHref) && openManagedPath) {
            await openManagedPath(linkHref);
            return;
          }
          await openExternalHref(linkHref);
        }}
        className="text-aegis-primary underline underline-offset-2 hover:text-aegis-primary/70"
      >
        {children}
      </a>
    );
  },
};

/** Desktop-aware Markdown rendering shared by chat bubbles and message previews. */
export function ChatMarkdownRenderer({ markdown }: ChatMarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      urlTransform={desktopUrlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
}
