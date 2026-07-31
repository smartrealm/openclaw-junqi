import assert from 'node:assert/strict';
import test from 'node:test';

import { loadInitialTranslationResources, loadTranslationResource } from './resources';

test('loads a requested locale as an isolated translation resource', async () => {
  const traditionalChinese = await loadTranslationResource('zh-TW');
  assert.equal(typeof traditionalChinese, 'object');
  assert.equal(typeof traditionalChinese.settings, 'object');
});

test('initial resources always include English fallback and the selected locale', async () => {
  const chineseResources = await loadInitialTranslationResources('zh');
  assert.deepEqual(Object.keys(chineseResources).sort(), ['en', 'zh']);
  assert.equal(typeof chineseResources.en.translation, 'object');
  assert.equal(typeof chineseResources.zh.translation, 'object');

  const englishResources = await loadInitialTranslationResources('en');
  assert.deepEqual(Object.keys(englishResources), ['en']);
});
