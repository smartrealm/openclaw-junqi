import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChannelLoginCommand,
  buildChannelSetupCommand,
  channelLinkMode,
  normalizeOfficialChannelCapability,
  normalizeOfficialChannelCatalog,
  redactChannelSecrets,
} from './openclawChannelRuntime';

describe('openclawChannelRuntime', () => {
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
      plugin: { meta: { label: 'Telegram' }, configSchema: { schema: {
        properties: { botToken: { type: 'string' } }, required: ['botToken'],
      } } },
      support: { media: true },
      actions: ['send'],
    }] });
    assert.equal(capability?.schema.botToken?.type, 'string');
    assert.deepEqual(capability?.required, ['botToken']);
  });

  test('routes official link flows by supported interaction', () => {
    assert.equal(channelLinkMode('whatsapp', true), 'embedded_qr');
    assert.equal(channelLinkMode('feishu', true), 'terminal_login');
    assert.equal(channelLinkMode('openclaw-weixin', true), 'terminal_login');
    assert.equal(channelLinkMode('signal', true), 'terminal_setup');
    assert.equal(channelLinkMode('new-plugin', false), 'terminal_setup');
  });

  test('builds safe cross-platform CLI commands and rejects flag injection', () => {
    assert.equal(buildChannelSetupCommand('telegram', 'work'), 'openclaw channels add --channel telegram --account work\n');
    assert.equal(buildChannelLoginCommand('feishu'), 'openclaw channels login --channel feishu\n');
    assert.throws(() => buildChannelSetupCommand('--delete'), /unsupported characters/);
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
