import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { inferMimeType } from '@/services/chat/attachments';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export interface DesktopAttachmentFile { name: string; path: string; base64: string; mimeType: string; isImage: boolean; size: number; }

export const desktopFileRuntime = {
  async selectFiles(): Promise<string[]> {
    const selected = await open({ multiple: true });
    return Array.isArray(selected) ? selected : selected ? [selected] : [];
  },
  async selectDirectory(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === 'string' ? selected : null;
  },
  async readAttachment(path: string): Promise<DesktopAttachmentFile | null> {
    try {
      const metadata = await stat(path);
      if (metadata.size > MAX_ATTACHMENT_BYTES) return null;
      const bytes = await readFile(path);
      const name = path.split(/[\\/]/).pop() || path;
      const mimeType = inferMimeType(name);
      return { name, path, base64: toBase64(bytes), mimeType, isImage: mimeType.startsWith('image/'), size: bytes.length };
    } catch { return null; }
  },
};
