import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ResultMarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-body max-h-[420px] overflow-auto rounded-lg bg-[rgb(var(--aegis-overlay)/0.03)] p-3 text-[12px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
