export interface MediaSaveResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

const MAX_MEDIA_SAVE_BYTES = 64 * 1024 * 1024;
const MEDIA_SAVE_TIMEOUT_MS = 30_000;

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() || 'bin';
}

async function readMediaBytes(source: string): Promise<Uint8Array> {
  if (/^data:[^;]+;base64,/i.test(source)) {
    const encoded = source.replace(/^data:[^;]+;base64,/i, '');
    if (Math.ceil(encoded.length * 3 / 4) > MAX_MEDIA_SAVE_BYTES) throw new Error('Media exceeds the 64 MB save limit');
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  }
  if (!/^(https?:|blob:|junqi-preview:)/i.test(source)) throw new Error('Unsupported media source');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MEDIA_SAVE_TIMEOUT_MS);
  try {
    const response = await fetch(source, { signal: controller.signal });
    if (!response.ok) throw new Error(`Media download failed (${response.status})`);
    const declaredBytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_MEDIA_SAVE_BYTES) throw new Error('Media exceeds the 64 MB save limit');
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function saveChatMedia(source: string, suggestedName: string): Promise<MediaSaveResult> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: suggestedName, filters: [{ name: 'Media', extensions: [extensionOf(suggestedName)] }] });
    if (!path) return { success: false, canceled: true };
    const bytes = await readMediaBytes(source);
    if (bytes.byteLength > MAX_MEDIA_SAVE_BYTES) throw new Error('Media exceeds the 64 MB save limit');
    await writeFile(path, bytes);
    return { success: true, path };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
