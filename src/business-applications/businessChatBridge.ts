import { useChatStore } from '@/stores/chatStore';
import type { BusinessChatRequest } from './types';

export function stageBusinessChatRequest(
  request: BusinessChatRequest,
  prompt: string,
): void {
  const { activeSessionKey, getDraft, setDraft } = useChatStore.getState();
  const existingDraft = getDraft(activeSessionKey).trim();
  const nextDraft = existingDraft ? `${existingDraft}\n\n${prompt}` : prompt;
  setDraft(activeSessionKey, nextDraft);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<BusinessChatRequest>('junqi:business-chat-request', { detail: request }));
  }
}
