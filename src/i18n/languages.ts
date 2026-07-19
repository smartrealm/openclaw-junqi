export const APP_LANGUAGES = ['en', 'zh', 'zh-TW'] as const;
export const LEGACY_LANGUAGES = ['ar'] as const;

export type AppLanguage = typeof APP_LANGUAGES[number];
export type LegacyLanguage = typeof LEGACY_LANGUAGES[number];
export type SupportedLanguage = AppLanguage | LegacyLanguage;

export const APP_LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === 'en' || value === 'zh' || value === 'zh-TW' || value === 'ar';
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'zh' || value === 'zh-TW';
}

export function normalizeLanguage(value: unknown): SupportedLanguage | null {
  return isSupportedLanguage(value) ? value : null;
}

export function languageDirection(lang: SupportedLanguage): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

export function browserDefaultLanguage(): AppLanguage {
  const raw = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
  if (/^zh-(tw|hk|mo)/.test(raw) || raw.includes('hant')) return 'zh-TW';
  return raw.startsWith('zh') ? 'zh' : 'en';
}

export function persistLanguagePreference(lang: SupportedLanguage): void {
  localStorage.setItem('aegis-language', lang);
}

export function applyDocumentLanguage(lang: SupportedLanguage): void {
  document.documentElement.dir = languageDirection(lang);
  document.documentElement.lang = lang;
}

export function nextPrimaryLanguage(lang: SupportedLanguage): AppLanguage {
  if (lang === 'zh') return 'zh-TW';
  if (lang === 'zh-TW') return 'en';
  return 'zh';
}
