import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const localeNames = ['zh', 'zh-TW', 'en'] as const;
const settingsSources = [
  new URL('../../pages/SettingsPage.tsx', import.meta.url),
  ...readdirSync(new URL('.', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.'))
    .map((entry) => new URL(entry.name, import.meta.url)),
];

const dynamicTranslationKeys = [
  ...['stopped', 'starting', 'running', 'error', 'reconnecting']
    .map((state) => 'gateway.lifecycle.' + state),
  ...['none', 'external', 'system_service', 'managed_child', 'docker']
    .map((mode) => 'gateway.runtimeMode.' + mode),
  ...['config', 'plugin', 'mcp', 'security', 'gateway', 'doctor']
    .map((category) => 'maintenance.category.' + category),
  ...['teal', 'blue', 'purple', 'rose', 'amber', 'emerald']
    .map((color) => 'settings.accent.' + color),
  ...['en', 'zh-CN', 'zh-TW']
    .map((locale) => 'settings.runtimeLanguageOptions.' + locale),
  ...['robot', 'jellyfish', 'blue-mascot', 'lobster', 'cat', 'ghost']
    .map((skin) => 'pet.settings.' + skin),
  ...['tool-calls', 'remote-login', 'python-venv', 'node-version', 'proxy', 'git-branch', 'git-diff']
    .map((item) => 'terminalSettings.statusItems.' + item),
];

function literalTranslationKeys(source: string): string[] {
  const keys = new Set<string>();
  const pattern = /\bt\(\s*(['"])([^'"\x60]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    keys.add(match[2]);
  }
  return [...keys];
}

function nestedValue(catalog: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, catalog);
}

test('settings surfaces have complete nested translations in every supported locale', () => {
  const usedKeys = new Set(dynamicTranslationKeys);
  for (const sourceUrl of settingsSources) {
    for (const key of literalTranslationKeys(readFileSync(sourceUrl, 'utf8'))) {
      usedKeys.add(key);
    }
  }

  for (const localeName of localeNames) {
    const catalog = JSON.parse(
      readFileSync(new URL('../../locales/' + localeName + '.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const missing = [...usedKeys]
      .filter((key) => {
        const value = nestedValue(catalog, key);
        return typeof value !== 'string' || value.trim() === '';
      })
      .sort();

    assert.deepEqual(missing, [], localeName + ' has incomplete settings translations');
  }
});

test('settings translation objects do not contain dot-delimited fallback keys', () => {
  for (const localeName of localeNames) {
    const catalog = JSON.parse(
      readFileSync(new URL('../../locales/' + localeName + '.json', import.meta.url), 'utf8'),
    ) as { settings?: Record<string, unknown> };
    const flatKeys = Object.keys(catalog.settings ?? {}).filter((key) => key.includes('.'));
    assert.deepEqual(flatKeys, [], localeName + ' has flat settings keys that i18next cannot resolve');
  }
});
