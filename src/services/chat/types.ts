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
export const MAX_SESSION_MESSAGE_QUEUE_BYTES = 64 * 1024 * 1024;

function encodedPayloadBytes(value: string | undefined): number {
  if (!value) return 0;
  const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
  const encoded = comma >= 0 ? value.slice(comma + 1) : value;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

export function queuedChatMessageBytes(message: QueuedChatMessage): number {
  const textBytes = new TextEncoder().encode(message.text).byteLength;
  const attachments = (message.attachments ?? []).reduce(
    (total, attachment) => total + encodedPayloadBytes(attachment.content),
    0,
  );
  const previews = (message.displayAttachments ?? []).reduce(
    (total, attachment) => total + encodedPayloadBytes(attachment.content),
    0,
  );
  return textBytes + attachments + previews;
}

export class SessionMessageQueueFullError extends Error {
  readonly code = 'SESSION_MESSAGE_QUEUE_FULL';

  constructor(readonly limit = MAX_SESSION_MESSAGE_QUEUE_SIZE) {
    super(`Session message queue is full (${limit} messages)`);
    this.name = 'SessionMessageQueueFullError';
  }
}

export class SessionMessageQueuePayloadLimitError extends Error {
  readonly code = 'SESSION_MESSAGE_QUEUE_PAYLOAD_LIMIT';

  constructor(readonly limit = MAX_SESSION_MESSAGE_QUEUE_BYTES) {
    super(`Session message queue payload exceeds ${Math.floor(limit / 1024 / 1024)} MB`);
    this.name = 'SessionMessageQueuePayloadLimitError';
  }
}
