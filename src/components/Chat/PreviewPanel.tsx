// ─────────────────────────────────────────────────────────────────
// PreviewPanel — right-side file preview in ChatView.
//
// Renders HTML (sandboxed iframe), Markdown (ReactMarkdown), SVG
// (inline), images (<img>), PDF (iframe embed), and code files
// (syntax-highlighted <pre>). Toggle between Preview and Source tabs.
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Code2, Eye, ExternalLink, FileWarning, RotateCcw, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { usePreviewStore, type PreviewType } from '@/stores/previewStore';

export function PreviewPanel() {
  const { t } = useTranslation();
  const { content, type, title, sourcePath, isOpen, sourceTab, close, toggle, showSource, showPreview } =
    usePreviewStore();

  // Listen for Escape to close (only when panel is focused).
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, close]);

  if (!isOpen || !type) return null;

  const isPreviewable = type === 'html' || type === 'markdown' || type === 'svg' || type === 'image';
  const tab = sourceTab || !isPreviewable ? 'source' : 'preview';

  return (
    <div
      className="flex flex-col h-full border-l border-aegis-border bg-aegis-bg"
      style={{ width: '42%', minWidth: 320, maxWidth: 640 }}
    >
      {/* Header: title + URL bar + actions */}
      <div className="flex flex-col shrink-0 border-b border-aegis-border bg-aegis-surface/60">
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-semibold text-aegis-text truncate">{title}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Tab switch: Preview | Source | Errors (WorkBuddy-style) */}
            <div className="inline-flex rounded-md overflow-hidden border border-aegis-border text-[10px]">
              <button onClick={showPreview}
                className={clsx('px-2 py-1 transition-colors', tab === 'preview' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text')}>
                <Eye size={11} className="inline mr-0.5" />Preview
              </button>
              <button onClick={showSource}
                className={clsx('px-2 py-1 transition-colors', tab === 'source' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text')}>
                <Code2 size={11} className="inline mr-0.5" />Source
              </button>
            </div>
            {sourcePath && (
              <button onClick={() => window.open(sourcePath.startsWith('/') || sourcePath.startsWith('~') ? `file://${sourcePath}` : sourcePath, '_blank')}
                title="Open externally" className="p-1.5 rounded text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-overlay/5">
                <ExternalLink size={12} />
              </button>
            )}
            <button onClick={close} title="Close preview"
              className="p-1.5 rounded text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-overlay/5">
              <X size={13} />
            </button>
          </div>
        </div>
        {/* URL bar — WorkBuddy-style address bar */}
        {sourcePath && (
          <div className="flex items-center gap-1.5 px-3 pb-1.5">
            <div className="flex-1 px-2 py-1 rounded text-[10px] font-mono text-aegis-text-dim bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border/50 truncate select-all">
              {sourcePath}
            </div>
            <button onClick={() => usePreviewStore.getState().open(content, type, title, sourcePath)} title="Refresh preview"
              className="p-1 rounded text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-overlay/5">
              <RotateCcw size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'preview' ? (
          <PreviewContent content={content} type={type} title={title} />
        ) : (
          <SourceContent content={content} />
        )}
      </div>
    </div>
  );
}

// ── Preview Content ──────────────────────────────────────────────────────────

function PreviewContent({
  content,
  type,
  title,
}: {
  content: string;
  type: PreviewType;
  title: string;
}) {
  if (type === 'html') {
    return (
      <iframe
        srcDoc={content}
        title={title}
        sandbox="allow-scripts"
        className="w-full h-full border-0"
        style={{ background: '#fff' }}
        referrerPolicy="no-referrer"
      />
    );
  }

  if (type === 'markdown') {
    return (
      <div className="h-full overflow-y-auto px-4 py-3 markdown-body text-[13px] leading-relaxed text-aegis-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  if (type === 'svg') {
    return (
      <div
        className="h-full overflow-auto flex items-center justify-center p-4"
        style={{ background: '#fff' }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  if (type === 'image') {
    return (
      <div className="h-full overflow-auto flex items-center justify-center p-2 bg-[rgb(var(--aegis-overlay)/0.02)]">
        <img
          src={content}
          alt={title}
          className="max-w-full max-h-full object-contain rounded"
        />
      </div>
    );
  }

  if (type === 'pdf') {
    return (
      <iframe
        src={content}
        title={title}
        className="w-full h-full border-0"
      />
    );
  }

  // Unsupported preview type
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40">
      <FileWarning size={28} className="text-aegis-text-dim" />
      <span className="text-[12px] text-aegis-text-dim">Preview not available for this file type</span>
    </div>
  );
}

// ── Source Content ───────────────────────────────────────────────────────────

function SourceContent({ content }: { content: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <pre className="text-[12px] text-aegis-text-secondary font-mono whitespace-pre-wrap p-4 leading-relaxed bg-[rgb(var(--aegis-overlay)/0.02)] min-h-full">
        {content.slice(0, 100_000)}{content.length > 100_000 ? '\n\n...(truncated at 100K chars)' : ''}
      </pre>
    </div>
  );
}