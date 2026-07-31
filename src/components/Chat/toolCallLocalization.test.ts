import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { TOOL_LABEL_KEYS } from './toolCallPresentation';

const LANGUAGE_NAMES = ['en', 'zh', 'zh-TW'] as const;

function translationValue(catalog: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, catalog);
}

test('built-in tool presentation labels resolve in every shipped language', () => {
  for (const language of LANGUAGE_NAMES) {
    const catalog = JSON.parse(readFileSync(
      resolve(process.cwd(), `src/locales/${language}.json`),
      'utf8',
    )) as Record<string, unknown>;

    for (const key of Object.values(TOOL_LABEL_KEYS)) {
      const value = translationValue(catalog, key);
      assert.equal(typeof value, 'string', `${language} is missing ${key}`);
      assert.ok((value as string).trim(), `${language} has an empty ${key}`);
    }
  }
});
