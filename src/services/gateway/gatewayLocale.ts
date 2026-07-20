/** Map the supported webview languages to the Gateway protocol locale tags. */
export function gatewayLocaleForLanguage(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase() || 'en';
  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.includes('hant')) return 'zh-TW';
  if (normalized.startsWith('zh')) return 'zh-CN';
  return 'en-US';
}
