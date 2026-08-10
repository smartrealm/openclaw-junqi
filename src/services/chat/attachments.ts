import type { GatewayAttachment, PreparedAttachment } from './types';
import type { GatewayAttachmentPolicy } from '@/services/gateway/GatewayConnectionPolicy';

const BASE64_SOURCE_BYTES = 3;
const BASE64_ENCODED_BYTES = 4;

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
    readonly code: 'FILE_SIZE_LIMIT' | 'EMPTY_CONTENT' | 'POLICY_UNAVAILABLE',
    readonly details: Readonly<{ fileName?: string; maxBytes?: number }> = {},
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

function payloadDecodedCeiling(maxPayload: number): number {
  return Math.max(1, Math.floor(maxPayload / BASE64_ENCODED_BYTES) * BASE64_SOURCE_BYTES);
}

/** 解析当前连接允许读取的单附件上限，不猜测数量、MIME 或模型能力。 */
export function resolveAttachmentByteLimit(
  policy: GatewayAttachmentPolicy | null,
  isImage: boolean,
): number {
  if (!policy) {
    throw new AttachmentValidationError(
      'Gateway attachment policy is unavailable',
      'POLICY_UNAVAILABLE',
    );
  }
  const advertised = isImage
    ? policy.maxImageBytes ?? policy.maxBytes
    : policy.maxBytes;
  const frameCeiling = payloadDecodedCeiling(policy.maxPayload);
  return advertised === undefined ? frameCeiling : Math.min(advertised, frameCeiling);
}

export function assertAttachmentSize(
  file: Readonly<{ size: number; isImage: boolean; fileName?: string }>,
  policy: GatewayAttachmentPolicy | null,
): void {
  const maxBytes = resolveAttachmentByteLimit(policy, file.isImage);
  if (file.size > maxBytes) {
    throw new AttachmentValidationError(
      'Attachment exceeds the current Gateway limit',
      'FILE_SIZE_LIMIT',
      { fileName: file.fileName, maxBytes },
    );
  }
}

export function validatePreparedAttachments(
  files: readonly PreparedAttachment[],
  policy: GatewayAttachmentPolicy | null,
): void {
  for (const file of files) {
    if (!file.content.trim()) {
      throw new AttachmentValidationError(
        'Attachment has no readable content',
        'EMPTY_CONTENT',
        { fileName: file.fileName ?? file.mimeType },
      );
    }
    assertAttachmentSize(file, policy);
  }
}

export function toGatewayAttachments(
  files: readonly PreparedAttachment[],
  policy: GatewayAttachmentPolicy | null,
): GatewayAttachment[] {
  validatePreparedAttachments(files, policy);
  return files.map((file) => ({
    type: file.isImage ? 'image' : 'file',
    mimeType: file.mimeType,
    content: stripDataUrlPrefix(file.content),
    ...(file.fileName ? { fileName: file.fileName } : {}),
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
      ...(file.fileName ? { fileName: file.fileName } : {}),
    }));
}

const OPENCLAW_EDITOR_IMAGE_MIME = /^image\/[\w.+-]+$/u;
const OPENCLAW_EDITOR_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const OPENCLAW_EDITOR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const OPENCLAW_EDITOR_IMAGE_MAX_BASE64_CHARS = Math.ceil(OPENCLAW_EDITOR_IMAGE_MAX_BYTES / 3) * 4;

function base64DecodedBytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

/** 仅恢复 OpenClaw 消息截断响应中可验证、受限的内联图片。 */
export function restoreOpenClawEditorImages(
  attachments: readonly { mimeType: string; data: string }[] = [],
): PreparedAttachment[] {
  return attachments.flatMap(({ mimeType, data }) => {
    if (
      !OPENCLAW_EDITOR_IMAGE_MIME.test(mimeType)
      || data.length === 0
      || data.length > OPENCLAW_EDITOR_IMAGE_MAX_BASE64_CHARS
      || !OPENCLAW_EDITOR_BASE64.test(data)
    ) return [];

    return [{
      id: crypto.randomUUID?.() ?? `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'image' as const,
      mimeType,
      content: data,
      isImage: true,
      size: base64DecodedBytes(data),
      preview: `data:${mimeType};base64,${data}`,
    }];
  });
}
