import assert from 'node:assert/strict';
import test from 'node:test';

import i18n, { changeLanguage, i18nReady } from './i18n';

test('language switching loads the selected locale before persisting it', async () => {
  await i18nReady;
  await changeLanguage('zh-TW');

  assert.equal(i18n.language, 'zh-TW');
  assert.equal(i18n.hasResourceBundle('zh-TW', 'translation'), true);
  assert.equal(localStorage.getItem('aegis-language'), 'zh-TW');
});
