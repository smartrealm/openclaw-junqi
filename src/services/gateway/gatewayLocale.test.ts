import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayLocaleForLanguage } from './gatewayLocale';

test('WIN-I18N-04 maps every supported application language to a Gateway locale', () => {
  assert.equal(gatewayLocaleForLanguage('zh'), 'zh-CN');
  assert.equal(gatewayLocaleForLanguage('zh-TW'), 'zh-TW');
  assert.equal(gatewayLocaleForLanguage('zh-HK'), 'zh-TW');
  assert.equal(gatewayLocaleForLanguage('en'), 'en-US');
  assert.equal(gatewayLocaleForLanguage('ar'), 'en-US');
  assert.equal(gatewayLocaleForLanguage(undefined), 'en-US');
});
