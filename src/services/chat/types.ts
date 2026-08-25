import type { OpenClawQueueMode } from '@/services/gateway/OpenClawQueueMode';

export interface GatewayAttachment {
  type?: 'image' | 'file' | 'base64';
  mimeType: string;
  content: string;
  fileName?: string;
}

export interface PreparedAttachment extends GatewayAttachment {
  id: string;
  isImage: boolean;
  size: number;
  preview?: string;
  sourcePath?: string;
}

export interface DisplayAttachment {
  mimeType: string;
  content: string;
  fileName?: string;
}

export interface OutboundChatPayload {
  text: string;
  sessionId?: string;
  queueMode?: OpenClawQueueMode;
  attachments?: GatewayAttachment[];
  displayAttachments?: DisplayAttachment[];
}
