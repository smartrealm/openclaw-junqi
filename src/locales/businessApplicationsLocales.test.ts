import assert from 'node:assert/strict';
import test from 'node:test';
import en from './en.json';
import zhTW from './zh-TW.json';
import zh from './zh.json';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

test('钉钉接入、DWS 操作与身份卡在三个语言资源中保持同一键集合', () => {
  for (const section of ['readiness', 'dws', 'runtimeIdentity'] as const) {
    const expected = leafKeys(zh.businessApplications[section]);
    assert.deepEqual(leafKeys(zhTW.businessApplications[section]), expected);
    assert.deepEqual(leafKeys(en.businessApplications[section]), expected);
  }
});

test('英文钉钉就绪状态不会回退到翻译键', () => {
  assert.equal(en.businessApplications.readiness.installDws, 'Install DWS');
  assert.equal(en.businessApplications.dws.installCompleted.includes('DWS'), true);
  assert.equal(en.businessApplications.runtimeIdentity.avatarAlt.includes('avatar'), true);
});
