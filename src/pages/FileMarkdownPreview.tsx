import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownPreviewComponents = {
  table({ children }: any) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    const codeString = String(children).replace(/\n$/, '');
    const isBlock = /language-(\w+)/.test(className || '') || codeString.includes('\n');
    if (isBlock) {
      return (
        <pre className="my-3 rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] p-3 text-[12px] leading-relaxed text-aegis-text-muted overflow-auto">
          <code {...props}>{codeString}</code>
        </pre>
      );
    }
    return (
      <code
        className="text-[12px] font-mono px-1.5 py-0.5 rounded"
        style={{ background: 'rgb(var(--aegis-primary) / 0.12)', color: 'rgb(var(--aegis-primary))' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  a({ href, children }: any) {
    return (
      <a
        href={href}
        onClick={async (e) => {
          e.preventDefault();
          if (!href) return;
          const openManagedPath =
            window.aegis?.managedFiles?.open ||
            window.aegis?.uploads?.open;
          const value = String(href).trim();
          if ((value.startsWith('/') || value.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('file://')) && openManagedPath) {
            await openManagedPath(value);
            return;
          }
          window.open(value, '_blank');
        }}
        className="text-aegis-primary hover:text-aegis-primary/70 underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
};

export function FileMarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-body p-4 text-[13px] leading-relaxed text-aegis-text overflow-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownPreviewComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
