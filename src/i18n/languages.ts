export const APP_LANGUAGES = ['en', 'zh', 'zh-TW'] as const;

export type AppLanguage = typeof APP_LANGUAGES[number];

export const APP_LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'zh' || value === 'zh-TW';
}

export function browserDefaultLanguage(): AppLanguage {
  const raw = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
  if (/^zh-(tw|hk|mo)/.test(raw) || raw.includes('hant')) return 'zh-TW';
  return raw.startsWith('zh') ? 'zh' : 'en';
}

export function persistLanguagePreference(lang: AppLanguage): void {
  localStorage.setItem('aegis-language', lang);
}

export function applyDocumentLanguage(lang: AppLanguage): void {
  document.documentElement.dir = 'ltr';
  document.documentElement.lang = lang;
}

export function nextPrimaryLanguage(lang: AppLanguage): AppLanguage {
  if (lang === 'zh') return 'zh-TW';
  if (lang === 'zh-TW') return 'en';
  return 'zh';
}
