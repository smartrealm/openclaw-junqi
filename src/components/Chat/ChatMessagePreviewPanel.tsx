import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import type { ChatMessagePreview } from './chatMessagePreview';
import { ChatSidePanel } from './ChatSidePanel';

interface ChatMessagePreviewPanelProps {
  preview: ChatMessagePreview;
  onClose: () => void;
  overlay?: boolean;
}

export function ChatMessagePreviewPanel({
  preview,
  onClose,
  overlay = false,
}: ChatMessagePreviewPanelProps) {
  const { t } = useTranslation();
  const titleId = `chat-preview-title-${preview.messageId}`;

  return (
    <ChatSidePanel
      title={t('chat.messagePreviewTitle')}
      titleId={titleId}
      closeLabel={t('chat.closeMessagePreview')}
      onClose={onClose}
      overlay={overlay}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin" data-chat-message-preview={preview.messageId}>
        <article className="markdown-body mx-auto w-full max-w-[760px] text-[15px] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.markdown}</ReactMarkdown>
        </article>
      </div>
    </ChatSidePanel>
  );
}
