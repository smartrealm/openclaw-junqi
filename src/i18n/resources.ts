import type { AppLanguage } from './languages';

export type TranslationResource = Record<string, unknown>;

type TranslationModule = { default: TranslationResource };

const resourceLoaders = {
  en: () => import('../locales/en.json'),
  zh: () => import('../locales/zh.json'),
  'zh-TW': () => import('../locales/zh-TW.json'),
} satisfies Record<AppLanguage, () => Promise<TranslationModule>>;

export async function loadTranslationResource(language: AppLanguage): Promise<TranslationResource> {
  const translationModule = await resourceLoaders[language]();
  return translationModule.default;
}

export async function loadInitialTranslationResources(
  language: AppLanguage,
): Promise<Record<string, { translation: TranslationResource }>> {
  const english = loadTranslationResource('en');
  const selected = language === 'en' ? english : loadTranslationResource(language);
  const [englishTranslation, selectedTranslation] = await Promise.all([english, selected]);

  return language === 'en'
    ? { en: { translation: englishTranslation } }
    : {
      en: { translation: englishTranslation },
      [language]: { translation: selectedTranslation },
    };
}
