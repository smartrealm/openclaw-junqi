import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';
import zh from './locales/zh.json';
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  isSupportedLanguage,
  persistLanguagePreference,
  type SupportedLanguage,
} from './i18n/languages';
import { syncNativeLocale } from './services/nativeLocale';

// ═══════════════════════════════════════════════════════════
// i18n — Internationalization (EN + ZH, Arabic kept for later)
// ═══════════════════════════════════════════════════════════

// Detect language priority:
//   1. Saved user choice wins (including legacy Arabic users)
//   2. First run uses the browser/system language (zh → ZH, otherwise EN)
// Native startup reads the OS locale separately so the tray is localized even
// before this webview has finished loading.
const getInitialLang = (): SupportedLanguage => {
  const stored = localStorage.getItem('aegis-language');

  if (stored && isSupportedLanguage(stored)) {
    return stored;
  }

  const browserLang = browserDefaultLanguage();
  persistLanguagePreference(browserLang);
  return browserLang;
};

const savedLang = getInitialLang();

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Helper: get direction for current language
export const getDirection = (lang?: string): 'rtl' | 'ltr' => {
  const current = isSupportedLanguage(lang) ? lang : isSupportedLanguage(i18n.language) ? i18n.language : 'en';
  return current === 'ar' ? 'rtl' : 'ltr';
};

// Helper: change language and persist
export const changeLanguage = (lang: SupportedLanguage) => {
  if (!isSupportedLanguage(lang)) return;
  i18n.changeLanguage(lang);
  persistLanguagePreference(lang);
  applyDocumentLanguage(lang);
  syncNativeLocale(lang);
};

// Set initial direction
applyDocumentLanguage(savedLang);
syncNativeLocale(savedLang);

export default i18n;
