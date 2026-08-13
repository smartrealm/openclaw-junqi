import type { AppLanguage } from './languages';

export type TranslationResource = Record<string, unknown>;

type TranslationModule = { default: TranslationResource };

const resourceLoaders = {
  en: () => import('../locales/en.json'),
  zh: () => import('../locales/zh.json'),
  'zh-TW': () => import('../locales/zh-TW.json'),
} satisfies Record<AppLanguage, () => Promise<TranslationModule>>;

function resolveNestedTranslationPath(
  resource: TranslationResource,
  path: string,
): unknown {
  let current: unknown = resource;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || !(segment in current)) return undefined;
    current = (current as TranslationResource)[segment];
  }
  return current;
}

export function findTranslationPathTypeConflicts(
  resource: TranslationResource,
): string[] {
  return Object.entries(resource)
    .filter(([key, flatValue]) => {
      if (!key.includes('.')) return false;
      const nestedValue = resolveNestedTranslationPath(resource, key);
      return nestedValue !== undefined && typeof nestedValue !== typeof flatValue;
    })
    .map(([key]) => key)
    .sort();
}

export async function loadTranslationResource(
  language: AppLanguage,
): Promise<TranslationResource> {
  const translationModule = await resourceLoaders[language]();
  const translation = translationModule.default;
  const conflicts = findTranslationPathTypeConflicts(translation);
  if (conflicts.length > 0) {
    throw new Error(
      `Translation resource ${language} has conflicting path types: ${conflicts.join(', ')}`,
    );
  }
  return translation;
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
