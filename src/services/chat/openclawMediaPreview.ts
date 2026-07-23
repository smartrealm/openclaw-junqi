export const OPENCLAW_MEDIA_SOURCE_PREFIX = 'aegis-media:';

export interface OpenClawMediaPreviewResult {
  success: boolean;
  url?: string | null;
  error?: string | null;
}

export interface OpenClawMediaPreviewBridge {
  openclawMedia?: {
    createPreview?: (path: string) => Promise<OpenClawMediaPreviewResult>;
  };
}

export function openClawMediaPath(source: string): string | null {
  if (!source.startsWith(OPENCLAW_MEDIA_SOURCE_PREFIX)) return null;
  const path = source.slice(OPENCLAW_MEDIA_SOURCE_PREFIX.length).trim();
  return path || null;
}

function defaultBridge(): OpenClawMediaPreviewBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.aegis;
}

/**
 * Resolves an OpenClaw transcript MediaPath through the native, state-scoped
 * preview command. The renderer never receives unrestricted file read access.
 */
export async function resolveOpenClawMediaPreviewUrl(
  source: string,
  bridge: OpenClawMediaPreviewBridge | undefined = defaultBridge(),
): Promise<string | null> {
  const path = openClawMediaPath(source);
  const createPreview = bridge?.openclawMedia?.createPreview;
  if (!path || !createPreview) return null;

  try {
    const result = await createPreview(path);
    return result.success && typeof result.url === 'string' && result.url.length > 0
      ? result.url
      : null;
  } catch {
    return null;
  }
}
