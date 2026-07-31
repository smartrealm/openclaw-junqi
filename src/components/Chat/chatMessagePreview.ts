import type { MessageBlock } from '@/types/RenderBlock';

export interface ChatMessagePreview {
  messageId: string;
  markdown: string;
}
export function createChatMessagePreview(block: MessageBlock): ChatMessagePreview | null {
  if (block.role !== 'assistant' || block.isStreaming) return null;
  const markdown = block.markdown.trim();
  if (!markdown) return null;
  return { messageId: block.id, markdown };
}
