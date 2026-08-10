import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function setupCopy(locale: 'zh' | 'zh-TW' | 'en', key: string): string {
  const content = readFileSync(resolve(process.cwd(), `src/locales/${locale}.json`), 'utf8');
  const dictionary = JSON.parse(content) as Record<string, string>;
  return dictionary[key] ?? '';
}

test('安装配置核验文案不将模型实时验证描述为首次安装门禁', () => {
  for (const locale of ['zh', 'zh-TW', 'en'] as const) {
    const copy = setupCopy(locale, 'setup.gatewayReadyCheckingDescription');
    assert.ok(copy.length > 0);
    assert.doesNotMatch(copy, /模型|模型|model/i);
  }
});
