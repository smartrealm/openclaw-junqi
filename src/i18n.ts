import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  isAppLanguage,
  persistLanguagePreference,
  type AppLanguage,
} from './i18n/languages';
import { loadInitialTranslationResources, loadTranslationResource } from './i18n/resources';
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

export const i18nReady = (async () => {
  const resources = await loadInitialTranslationResources(savedLang);
  await i18n.use(initReactI18next).init({
    resources,
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
})();

// Helper: get direction for current language
export const getDirection = (_lang?: string): 'rtl' | 'ltr' => {
  return 'ltr';
};

// Helper: change language and persist
export const changeLanguage = async (lang: AppLanguage): Promise<void> => {
  if (!isAppLanguage(lang)) return;

  await i18nReady;
  try {
    if (!i18n.hasResourceBundle(lang, 'translation')) {
      const translation = await loadTranslationResource(lang);
      i18n.addResourceBundle(lang, 'translation', translation, true, true);
    }

    await i18n.changeLanguage(lang);
  } catch {
    // Keep the active resource bundle and persisted preference when a lazy
    // chunk is unavailable rather than leaving the UI on untranslated keys.
    return;
  }

  persistLanguagePreference(lang);
  applyDocumentLanguage(lang);
  syncNativeLocale(lang);
};

// Set initial direction
applyDocumentLanguage(savedLang);
void i18nReady.then(() => syncNativeLocale(savedLang));

export default i18n;
