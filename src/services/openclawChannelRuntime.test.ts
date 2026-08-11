import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChannelSetupCommand,
  channelErrorMessage,
  channelLinkMode,
  isOpenClawChannelIdentifier,
  loadOfficialChannelRuntimeState,
  normalizeOfficialChannelCapability,
  normalizeOfficialChannelCatalog,
  redactChannelSecrets,
  runtimeChannelIds,
} from './openclawChannelRuntime';

describe('openclawChannelRuntime', () => {
  test('formats structured runtime failures without relying on any-typed errors', () => {
    assert.equal(channelErrorMessage({ message: 'Gateway unavailable' }), 'Gateway unavailable');
    assert.equal(channelErrorMessage(new Error('Request failed')), 'Request failed');
    assert.equal(channelErrorMessage('timeout'), 'timeout');
  });

  test('normalizes the official dynamic catalog without a static allowlist', () => {
    const catalog = normalizeOfficialChannelCatalog({
      version: 'OpenClaw 2026.7.1',
      chat: {
        'future-channel': { accounts: ['work'], installed: true, origin: 'configured' },
      },
    });
    assert.equal(catalog.entries[0]?.id, 'future-channel');
    assert.equal(catalog.entries[0]?.installed, true);
    assert.equal(catalog.source, 'openclaw-cli');
  });

  test('extracts plugin-owned schema and capabilities', () => {
    const capability = normalizeOfficialChannelCapability({ channels: [{
      channel: 'telegram',
      plugin: {
        meta: { label: 'Telegram' },
        configSchema: { schema: {
          properties: { botToken: { type: 'string' } }, required: ['botToken'],
        } },
        gatewayMethods: ['web.login.start'],
        gatewayMethodDescriptors: [{ name: 'web.login.wait' }],
      },
      support: { media: true },
      actions: ['send'],
    }] });
    assert.equal(capability?.schema.botToken?.type, 'string');
    assert.deepEqual(capability?.required, ['botToken']);
    assert.deepEqual(capability?.gatewayMethods, ['web.login.start', 'web.login.wait']);
  });

  test('discovers delivery channel ids from arbitrary current runtime status shapes', () => {
    assert.deepEqual(runtimeChannelIds({
      channelOrder: ['runtime-a'],
      configuredChannels: ['runtime-b'],
      channelAccounts: { 'runtime-c': [] },
      channels: { 'runtime-d': {} },
    }).sort(), ['runtime-a', 'runtime-b', 'runtime-c', 'runtime-d']);
    assert.deepEqual(runtimeChannelIds(undefined), []);
  });

  test('渠道状态请求由服务层统一生成官方参数', async () => {
    const calls: unknown[] = [];
    const result = await loadOfficialChannelRuntimeState(async (method, params) => {
      calls.push({ method, params });
      return { channelAccounts: {} };
    }, 'telegram', true);

    assert.deepEqual(calls, [{
      method: 'channels.status',
      params: { probe: true, timeoutMs: 15000, channel: 'telegram' },
    }]);
    assert.deepEqual(result, { channelAccounts: {} });
  });

  test('routes official link flows only from current runtime capabilities', () => {
    const qrCapability = normalizeOfficialChannelCapability({
      channels: [{
        channel: 'provider',
        plugin: { gatewayMethods: ['web.login.start', 'web.login.wait'] },
      }],
    });
    const capabilityWithoutQr = normalizeOfficialChannelCapability({ channels: [{ channel: 'openclaw-weixin' }] });
    assert.equal(channelLinkMode(qrCapability, true), 'embedded_qr');
    assert.equal(channelLinkMode(capabilityWithoutQr, true), 'none');
    assert.equal(channelLinkMode(null, true), 'none');
    assert.equal(channelLinkMode(null, false), 'terminal_setup');
  });

  test('builds safe cross-platform CLI commands and rejects flag injection', () => {
    assert.equal(buildChannelSetupCommand('telegram', 'work'), 'openclaw channels add --channel telegram --account work\n');
    assert.throws(() => buildChannelSetupCommand('--delete'), /unsupported characters/);
  });

  test('uses the native identifier contract for channel and account IDs', () => {
    assert.equal(isOpenClawChannelIdentifier('a'), true);
    assert.equal(isOpenClawChannelIdentifier('account.id:work_item-1'), true);
    assert.equal(isOpenClawChannelIdentifier(`a${'x'.repeat(127)}`), true);
    assert.equal(isOpenClawChannelIdentifier(''), false);
    assert.equal(isOpenClawChannelIdentifier('-account'), false);
    assert.equal(isOpenClawChannelIdentifier(`a${'x'.repeat(128)}`), false);
    assert.equal(isOpenClawChannelIdentifier('account;delete'), false);
  });

  test('reads managed installation authority only from the native catalog payload', () => {
    const catalog = normalizeOfficialChannelCatalog({
      chat: {
        'runtime-managed': { installed: false, managedInstall: true },
        'runtime-setup-only': { installed: false },
      },
    });
    assert.equal(catalog.entries.find((entry) => entry.id === 'runtime-managed')?.managedInstall, true);
    assert.equal(catalog.entries.find((entry) => entry.id === 'runtime-setup-only')?.managedInstall, false);
  });

  test('recursively redacts nested channel credentials', () => {
    assert.deepEqual(redactChannelSecrets({
      token: 'one',
      accounts: { work: { appSecret: 'two', nested: [{ password: 'three' }], appId: 'visible' } },
    }), {
      token: '[REDACTED]',
      accounts: { work: { appSecret: '[REDACTED]', nested: [{ password: '[REDACTED]' }], appId: 'visible' } },
    });
  });
});
