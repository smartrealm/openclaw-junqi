import { invoke } from '@tauri-apps/api/core';

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, '');
}

/** Extract URLs from Gateway-owned plain notes without interpreting provider copy. */
export function extractWizardUrls(message: unknown): string[] {
  if (typeof message !== 'string') return [];
  const urls = message.match(HTTP_URL_PATTERN)?.map(trimUrlPunctuation) ?? [];
  return [...new Set(urls)];
}

export async function renderWizardQrDataUrl(url: string): Promise<string | null> {
  try {
    const value = await invoke<unknown>('render_qr_code_data_url', { content: url });
    return typeof value === 'string' && value.startsWith('data:image/svg+xml;base64,') ? value : null;
  } catch {
    return null;
  }
}

/**
 * Renders provider-owned QR content entirely in-process. No image URL is
 * loaded by the webview, which keeps login payloads out of third-party CDNs.
 */
export async function renderLocalQrDataUrl(content: string): Promise<string | null> {
  try {
    const value = await invoke<unknown>('render_local_qr_data_url', { content });
    return typeof value === 'string' && value.startsWith('data:image/svg+xml;base64,') ? value : null;
  } catch {
    return null;
  }
}
