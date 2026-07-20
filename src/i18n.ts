import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';
import zhTW from './locales/zh-TW.json';
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  isAppLanguage,
  persistLanguagePreference,
  type AppLanguage,
} from './i18n/languages';
import { syncNativeLocale } from './services/nativeLocale';

// ═══════════════════════════════════════════════════════════
// i18n — Internationalization (English, Simplified Chinese, Traditional Chinese)
// ═══════════════════════════════════════════════════════════

// Detect language priority:
//   1. Saved supported app choice wins
//   2. First run uses the browser/system language (zh → ZH, otherwise EN)
// Native startup reads the OS locale separately so the tray is localized even
// before this webview has finished loading.
const getInitialLang = (): AppLanguage => {
  const stored = localStorage.getItem('aegis-language');

  if (stored && isAppLanguage(stored)) {
    return stored;
  }

  const browserLang = browserDefaultLanguage();
  persistLanguagePreference(browserLang);
  return browserLang;
};

const savedLang = getInitialLang();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    'zh-TW': { translation: zhTW },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Helper: get direction for current language
export const getDirection = (lang?: string): 'rtl' | 'ltr' => {
  return 'ltr';
};

// Helper: change language and persist
export const changeLanguage = (lang: AppLanguage) => {
  if (!isAppLanguage(lang)) return;
  i18n.changeLanguage(lang);
  persistLanguagePreference(lang);
  applyDocumentLanguage(lang);
  syncNativeLocale(lang);
};

// Set initial direction
applyDocumentLanguage(savedLang);
syncNativeLocale(savedLang);

export default i18n;
