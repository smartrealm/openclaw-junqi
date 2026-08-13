import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findTranslationPathTypeConflicts,
  loadInitialTranslationResources,
  loadTranslationResource,
} from './resources';

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

test('每种语言都不能用扁平字符串键覆盖同名对象路径', async () => {
  for (const language of ['en', 'zh', 'zh-TW'] as const) {
    const resource = await loadTranslationResource(language);
    assert.deepEqual(findTranslationPathTypeConflicts(resource), [], language);
  }
});

test('国际化资源检查只报告同一路径的类型冲突', () => {
  assert.deepEqual(
    findTranslationPathTypeConflicts({
      storage: { progress: { label: 'Progress' } },
      'storage.progress': 'Progress',
    }),
    ['storage.progress'],
  );
  assert.deepEqual(
    findTranslationPathTypeConflicts({
      storage: { title: 'Storage' },
      'storage.title': 'Storage',
    }),
    [],
  );
});
