import type { GatewayAttachment, PreparedAttachment } from './types';

export const ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 10,
  maxImageBytes: 6 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
});

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  mp4: 'video/mp4',
};

export class AttachmentValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'COUNT_LIMIT' | 'FILE_SIZE_LIMIT' | 'TOTAL_SIZE_LIMIT' | 'EMPTY_CONTENT',
  ) {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}

export function inferMimeType(fileName: string, provided?: string): string {
  const normalized = provided?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? normalized ?? 'application/octet-stream';
}

export function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '');
}

export function validatePreparedAttachments(files: readonly PreparedAttachment[]): void {
  if (files.length > ATTACHMENT_LIMITS.maxCount) {
    throw new AttachmentValidationError(
      `A maximum of ${ATTACHMENT_LIMITS.maxCount} attachments is supported`,
      'COUNT_LIMIT',
    );
  }

  let totalBytes = 0;
  for (const file of files) {
    if (!file.content.trim()) {
      throw new AttachmentValidationError(`${file.fileName} has no readable content`, 'EMPTY_CONTENT');
    }
    const perFileLimit = file.isImage
      ? ATTACHMENT_LIMITS.maxImageBytes
      : ATTACHMENT_LIMITS.maxFileBytes;
    if (file.size > perFileLimit) {
      throw new AttachmentValidationError(
        `${file.fileName} exceeds the ${Math.floor(perFileLimit / 1024 / 1024)} MB limit`,
        'FILE_SIZE_LIMIT',
      );
    }
    totalBytes += file.size;
  }

  if (totalBytes > ATTACHMENT_LIMITS.maxTotalBytes) {
    throw new AttachmentValidationError('The selected attachments exceed the 50 MB total limit', 'TOTAL_SIZE_LIMIT');
  }
}

export function toGatewayAttachments(files: readonly PreparedAttachment[]): GatewayAttachment[] {
  validatePreparedAttachments(files);
  return files.map((file) => ({
    type: file.isImage ? 'image' : 'file',
    mimeType: file.mimeType,
    content: stripDataUrlPrefix(file.content),
    fileName: file.fileName,
  }));
}

export function createPreparedAttachment(input: {
  fileName: string;
  mimeType?: string;
  base64: string;
  size: number;
  preview?: string;
  sourcePath?: string;
}): PreparedAttachment {
  const mimeType = inferMimeType(input.fileName, input.mimeType);
  const content = stripDataUrlPrefix(input.base64);
  return {
    id: crypto.randomUUID?.() ?? `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: mimeType.startsWith('image/') ? 'image' : 'file',
    fileName: input.fileName,
    mimeType,
    content,
    isImage: mimeType.startsWith('image/'),
    size: input.size,
    preview: input.preview,
    sourcePath: input.sourcePath,
  };
}

export function displayAttachments(files: readonly PreparedAttachment[]) {
  return files
    .filter((file) => file.isImage && file.preview)
    .map((file) => ({
      mimeType: file.mimeType,
      content: file.preview!,
      fileName: file.fileName,
    }));
}
