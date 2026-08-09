import { gateway } from '@/services/gateway';
import { ChatSendCoordinator } from '@/services/chat/sendTransaction';
import { useChatStore } from '@/stores/chatStore';

export const chatSendCoordinator = new ChatSendCoordinator(
  gateway,
  () => useChatStore.getState(),
);
