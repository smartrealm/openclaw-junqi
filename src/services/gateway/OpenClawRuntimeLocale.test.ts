import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readOpenClawRuntimeLocaleState,
  resolveOpenClawRuntimeLocale,
  saveOpenClawRuntimeLocale,
} from './OpenClawRuntimeLocale';

test('运行时语言使用 OpenClaw 原生规则归一化', () => {
  assert.equal(resolveOpenClawRuntimeLocale('en_US.UTF-8'), 'en');
  assert.equal(resolveOpenClawRuntimeLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveOpenClawRuntimeLocale('zh_HK.UTF-8'), 'zh-TW');
  assert.equal(resolveOpenClawRuntimeLocale('ja-JP'), null);
  assert.equal(resolveOpenClawRuntimeLocale(undefined), null);
});

test('读取状态保留无法识别的 Runtime 原始值', () => {
  assert.deepEqual(readOpenClawRuntimeLocaleState({
    exists: true,
    hash: 'config-hash',
    config: { env: { vars: { OPENCLAW_LOCALE: 'ja-JP' } } },
  }), {
    locale: null,
    rawLocale: 'ja-JP',
  });
});

test('保存语言先读取最新快照并仅写入官方 locale 配置', async () => {
  const calls: unknown[] = [];
  const snapshot = {
    exists: true,
    hash: 'config-hash',
    config: { gateway: { mode: 'local' } },
  };
  await saveOpenClawRuntimeLocale({
    async read() {
      calls.push('read');
      return snapshot;
    },
    async patch(config, receivedSnapshot, replacePaths) {
      calls.push({ config, receivedSnapshot, replacePaths });
    },
  }, 'zh-TW');

  assert.deepEqual(calls, [
    'read',
    {
      config: { env: { vars: { OPENCLAW_LOCALE: 'zh-TW' } } },
      receivedSnapshot: snapshot,
      replacePaths: undefined,
    },
  ]);
});
