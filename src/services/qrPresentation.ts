import { invoke } from '@tauri-apps/api/core';

/**
 * Renders a QR payload supplied by a selected local channel adapter entirely
 * in-process. The webview never loads it as a remote image.
 */
export async function renderLocalQrDataUrl(content: string): Promise<string | null> {
  try {
    const value = await invoke<unknown>('render_local_qr_data_url', { content });
    return typeof value === 'string' && value.startsWith('data:image/svg+xml;base64,')
      ? value
      : null;
  } catch {
    return null;
  }
}
