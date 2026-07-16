import { invoke } from '@tauri-apps/api/core';
import type { SupportedLanguage } from '@/i18n/languages';

let pendingSync: Promise<unknown> = Promise.resolve();

/**
 * Keep native UI surfaces (currently the tray menu) in lockstep with the
 * webview locale. Requests are serialized so rapid language changes cannot
 * leave the native menu on an older selection.
 */
export function syncNativeLocale(language: SupportedLanguage): void {
  const request = pendingSync.then(() =>
    invoke<string>('set_application_language', { language }),
  );
  pendingSync = request.then(() => undefined, () => undefined);
}
