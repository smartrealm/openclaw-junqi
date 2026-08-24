import type { GatewayAttachment } from '@/services/chat/types';
import type { OpenClawSessionGroup } from '@/services/gateway/OpenClawSessionGroupsClient';

export interface ChatGatewayOperations {
  setSessionPinned(pinned: boolean, sessionKey: string): Promise<unknown>;
  setSessionUnread(unread: boolean, sessionKey: string): Promise<unknown>;
  setSessionArchived(archived: boolean, sessionKey: string, expectedSessionId?: string): Promise<unknown>;
  setSessionCategory(category: string | null, sessionKey: string): Promise<string | null>;
  listSessionGroups(): Promise<readonly OpenClawSessionGroup[]>;
  ensureSessionGroup(name: string): Promise<readonly OpenClawSessionGroup[]>;
  sendMessage(
    message: string,
    attachments: GatewayAttachment[] | undefined,
    sessionKey: string,
    identity?: {
      clientMessageId?: string;
      sessionId?: string;
      expectedLeafEntryId?: string | null;
      delivery?: 'send' | 'steer';
    },
  ): Promise<unknown>;
}

let operations: ChatGatewayOperations | null = null;

export function configureChatGatewayOperations(next: ChatGatewayOperations): void {
  operations = next;
}

export function getChatGatewayOperations(): ChatGatewayOperations {
  if (!operations) {
    throw new Error('Chat Gateway operations have not been configured');
  }
  return operations;
}
