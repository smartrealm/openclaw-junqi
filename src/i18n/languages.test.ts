import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_LANGUAGE_OPTIONS,
  browserDefaultLanguage,
  isSupportedLanguage,
  languageDirection,
  nextPrimaryLanguage,
} from './languages';

test('visible app language options are Chinese and English', () => {
  assert.deepEqual(APP_LANGUAGE_OPTIONS.map((option) => option.value), ['zh', 'en']);
});

test('legacy Arabic remains supported for persisted users', () => {
  assert.equal(isSupportedLanguage('ar'), true);
  assert.equal(languageDirection('ar'), 'rtl');
});

test('command palette cycles between primary languages only', () => {
  assert.equal(nextPrimaryLanguage('zh'), 'en');
  assert.equal(nextPrimaryLanguage('en'), 'zh');
  assert.equal(nextPrimaryLanguage('ar'), 'zh');
});

test('browser default language normalizes to primary languages', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-CN', languages: ['zh-CN'] },
    configurable: true,
  });
  try {
    assert.equal(browserDefaultLanguage(), 'zh');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  }
});
