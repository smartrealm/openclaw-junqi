export interface GatewayAttachment {
  type?: 'image' | 'file' | 'base64';
  mimeType: string;
  content: string;
  fileName: string;
}

export interface PreparedAttachment extends GatewayAttachment {
  id: string;
  isImage: boolean;
  size: number;
  preview?: string;
  sourcePath?: string;
}

export interface QueuedChatMessage {
  id: string;
  text: string;
  timestamp: string;
  sessionId?: string;
  attachments?: GatewayAttachment[];
  displayAttachments?: Array<{
    mimeType: string;
    content: string;
    fileName: string;
  }>;
  failed?: boolean;
  error?: string;
}
