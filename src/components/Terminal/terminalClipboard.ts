import { invoke } from '@tauri-apps/api/core';
import { debugError } from '@/utils/debugLog';

const MAX_CLIPBOARD_IMAGE_BYTES = 12 * 1024 * 1024;

export function normalizeTerminalImageMimeType(mimeType: string): string | null {
  switch (mimeType.trim().toLowerCase()) {
    case 'image/png':
      return 'image/png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'image/jpeg';
    case 'image/webp':
      return 'image/webp';
    case 'image/gif':
      return 'image/gif';
    default:
      return null;
  }
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('clipboard image read failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('clipboard image data is unavailable'));
        return;
      }
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('clipboard image data is malformed'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function stageClipboardImage(blob: Blob, mimeType: string): Promise<string | null> {
  const normalizedMimeType = normalizeTerminalImageMimeType(mimeType || blob.type);
  if (!normalizedMimeType || blob.size <= 0 || blob.size > MAX_CLIPBOARD_IMAGE_BYTES) return null;

  try {
    const base64Data = await readBlobAsBase64(blob);
    return await invoke<string>('stage_terminal_paste_image', {
      mimeType: normalizedMimeType,
      base64Data,
    });
  } catch (error) {
    // Do not log image data or file names. The caller can safely fall back to
    // text paste when the OS does not expose a readable image clipboard.
    debugError('terminal', '[terminal] unable to stage clipboard image:', error);
    return null;
  }
}

export function imageFromClipboardEvent(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (!normalizeTerminalImageMimeType(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** Stage an image from a native textarea paste event, if one is present. */
export async function readTerminalClipboardEvent(event: ClipboardEvent): Promise<string | null> {
  const image = imageFromClipboardEvent(event);
  return image ? stageClipboardImage(image, image.type) : null;
}

async function readClipboardImage(): Promise<string | null> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.read !== 'function') return null;

  try {
    const items = await clipboard.read();
    for (const item of items) {
      const mimeType = item.types.find((type) => normalizeTerminalImageMimeType(type));
      if (!mimeType) continue;
      const blob = await item.getType(mimeType);
      const staged = await stageClipboardImage(blob, mimeType);
      if (staged) return staged;
    }
  } catch (error) {
    debugError('terminal', '[terminal] unable to read image clipboard:', error);
  }
  return null;
}

/**
 * Kooky-compatible paste precedence: image -> staged safe path, then plain
 * text. The returned text must be fed to xterm.paste(), not written directly
 * to the PTY, so bracketed-paste mode stays intact.
 */
export async function readTerminalClipboardText(): Promise<string> {
  const imagePath = await readClipboardImage();
  if (imagePath) return imagePath;
  return navigator.clipboard?.readText().catch(() => '') ?? '';
}
