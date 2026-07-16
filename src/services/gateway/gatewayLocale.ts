/** Map the supported webview languages to the Gateway protocol locale tags. */
export function gatewayLocaleForLanguage(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase() || 'en';
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('ar')) return 'ar-SA';
  return 'en-US';
}
