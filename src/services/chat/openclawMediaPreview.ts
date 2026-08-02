import {
  createOpenClawMediaPreviewUrl,
  type OpenClawMediaPreviewResult,
} from '@/api/tauri-commands';

export const OPENCLAW_MEDIA_SOURCE_PREFIX = 'aegis-media:';

export interface OpenClawMediaPreviewReader {
  createPreview: (path: string) => Promise<OpenClawMediaPreviewResult>;
}

export function openClawMediaPath(source: string): string | null {
  if (!source.startsWith(OPENCLAW_MEDIA_SOURCE_PREFIX)) return null;
  const path = source.slice(OPENCLAW_MEDIA_SOURCE_PREFIX.length).trim();
  return path || null;
}

const nativePreviewReader: OpenClawMediaPreviewReader = {
  createPreview: createOpenClawMediaPreviewUrl,
};

/**
 * Resolves an OpenClaw transcript MediaPath through the native, state-scoped
 * preview command. The renderer never receives unrestricted file read access.
 */
export async function resolveOpenClawMediaPreviewUrl(
  source: string,
  reader: OpenClawMediaPreviewReader = nativePreviewReader,
): Promise<string | null> {
  const path = openClawMediaPath(source);
  if (!path) return null;

  try {
    const result = await reader.createPreview(path);
    return result.success && typeof result.url === 'string' && result.url.length > 0
      ? result.url
      : null;
  } catch {
    return null;
  }
}
