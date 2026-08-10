import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import {
  AttachmentValidationError,
  assertAttachmentSize,
  inferMimeType,
} from '@/services/chat/attachments';
import type { GatewayAttachmentPolicy } from '@/services/gateway/GatewayConnectionPolicy';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export interface DesktopAttachmentFile { name: string; path: string; base64: string; mimeType: string; isImage: boolean; size: number; }

export class DesktopAttachmentReadError extends Error {
  readonly code = 'READ_FAILED' as const;
  readonly cause: unknown;

  constructor(readonly path: string, cause?: unknown) {
    super('Desktop attachment could not be read');
    this.name = 'DesktopAttachmentReadError';
    this.cause = cause;
  }
}

export const desktopFileRuntime = {
  async selectFiles(): Promise<string[]> {
    const selected = await open({ multiple: true });
    return Array.isArray(selected) ? selected : selected ? [selected] : [];
  },
  async selectDirectory(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === 'string' ? selected : null;
  },
  async readAttachment(
    path: string,
    policy: GatewayAttachmentPolicy | null,
  ): Promise<DesktopAttachmentFile> {
    try {
      const metadata = await stat(path);
      const name = path.split(/[\\/]/).pop() || path;
      const mimeType = inferMimeType(name);
      const isImage = mimeType.startsWith('image/');
      assertAttachmentSize({ size: metadata.size, isImage, fileName: name }, policy);
      const bytes = await readFile(path);
      assertAttachmentSize({ size: bytes.length, isImage, fileName: name }, policy);
      return { name, path, base64: toBase64(bytes), mimeType, isImage, size: bytes.length };
    } catch (error) {
      if (error instanceof AttachmentValidationError) throw error;
      throw new DesktopAttachmentReadError(path, error);
    }
  },
};
