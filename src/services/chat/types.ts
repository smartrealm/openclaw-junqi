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

export interface DisplayAttachment {
  mimeType: string;
  content: string;
  fileName: string;
}

export interface OutboundChatPayload {
  text: string;
  sessionId?: string;
  attachments?: GatewayAttachment[];
  displayAttachments?: DisplayAttachment[];
}

export interface QueuedChatMessage extends OutboundChatPayload {
  id: string;
  timestamp: string;
  failed?: boolean;
  error?: string;
}

export const MAX_SESSION_MESSAGE_QUEUE_SIZE = 50;

export class SessionMessageQueueFullError extends Error {
  readonly code = 'SESSION_MESSAGE_QUEUE_FULL';

  constructor(readonly limit = MAX_SESSION_MESSAGE_QUEUE_SIZE) {
    super(`Session message queue is full (${limit} messages)`);
    this.name = 'SessionMessageQueueFullError';
  }
}
