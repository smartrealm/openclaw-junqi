import { useTranslation } from 'react-i18next';
import type { ChatMessagePreview } from './chatMessagePreview';
import { ChatSidePanel } from './ChatSidePanel';
import { ChatMarkdownRenderer } from './ChatMarkdownRenderer';

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
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 chat-scrollbar" data-chat-message-preview={preview.messageId}>
        <article className="markdown-body mx-auto w-full max-w-[760px] text-[15px] leading-relaxed">
          <ChatMarkdownRenderer markdown={preview.markdown} />
        </article>
      </div>
    </ChatSidePanel>
  );
}
