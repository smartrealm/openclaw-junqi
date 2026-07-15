import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addChannelAccount,
  assessChannelAccountReadiness,
  buildChannelGroups,
  channelAccountEditorValues,
  getRequiredCredentialFields,
  persistChannelsOnlyWithRepository,
  migrateLegacyChannelBindings,
  removeAgentChannelBindings,
  upsertChannelAccount,
  type ChannelConfigRepository,
} from './channelConfig';
import type { GatewayRuntimeConfig } from '@/pages/ConfigManager/types';

function cfg(overrides: Record<string, unknown>): GatewayRuntimeConfig {
  return overrides as GatewayRuntimeConfig;
}

describe('channelConfig', () => {
  test('buildChannelGroups normalizes account-level and legacy channel-level bindings', () => {
    const groups = buildChannelGroups(cfg({
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            prod: { name: 'Production', enabled: true, agentId: 'support', appId: 'app', appSecret: 'secret' },
            muted: { enabled: false, agentId: 'ops' },
          },
        },
        telegram: {
          enabled: true,
          agentId: 'main',
          botToken: 'token',
        },
        modelByChannel: { ignored: true },
      },
    }));

    const feishu = groups.find((group) => group.id === 'feishu');
    assert.ok(feishu);
    assert.deepEqual(feishu.accounts.map((account) => ({
      id: account.id,
      label: account.label,
      enabled: account.enabled,
      agentId: account.agentId,
      source: account.source,
    })), [
      { id: 'prod', label: 'Production', enabled: true, agentId: 'support', source: 'account' },
      { id: 'muted', label: 'muted', enabled: false, agentId: 'ops', source: 'account' },
    ]);

    const telegram = groups.find((group) => group.id === 'telegram');
    assert.equal(telegram?.accounts[0]?.id, 'default');
    assert.equal(telegram?.accounts[0]?.agentId, 'main');
    assert.equal(telegram?.accounts[0]?.source, 'channel');
    assert.equal(groups.some((group) => group.id === 'modelByChannel'), false);
  });

  test('addChannelAccount preserves channel settings and adds the requested account', () => {
    const original = cfg({
      channels: {
        discord: {
          enabled: true,
          dmPolicy: 'pairing',
          accounts: {
            default: { token: 'old', agentId: 'main' },
          },
        },
      },
    });

    const next = addChannelAccount(original, 'discord', 'ops', {
      name: 'Ops',
      token: 'new',
      agentId: 'ops-agent',
    });

    assert.equal(next.channels?.discord?.dmPolicy, 'pairing');
    assert.deepEqual(next.channels?.discord?.accounts?.ops, {
      name: 'Ops',
      token: 'new',
    });
    assert.deepEqual(next.bindings, [{
      type: 'route',
      agentId: 'ops-agent',
      match: { channel: 'discord', accountId: 'ops' },
    }]);
    assert.deepEqual(original.channels?.discord?.accounts, {
      default: { token: 'old', agentId: 'main' },
    });
  });

  test('official dingtalk-connector accounts require the current plugin credentials', () => {
    assert.deepEqual(getRequiredCredentialFields('dingtalk-connector'), ['clientId', 'clientSecret']);

    const [account] = buildChannelGroups(cfg({
      channels: {
        'dingtalk-connector': {
          enabled: true,
          accounts: {
            ops: {
              name: 'Ops DingTalk',
              enabled: true,
              agentId: 'ops-agent',
              clientId: 'key',
            },
          },
        },
      },
    })).flatMap((group) => group.accounts);

    assert.ok(account);
    assert.deepEqual(assessChannelAccountReadiness('dingtalk-connector', account), {
      state: 'missing_credentials',
      missingFields: ['clientSecret'],
      messages: ['missing_credentials'],
    });
  });

  test('binding changes use root official bindings and preserve specific and ACP routes', () => {
    const original = cfg({
      channels: { whatsapp: { accounts: { work: { enabled: true, agentId: 'legacy' } } } },
      bindings: [
        { type: 'route', agentId: 'old', match: { channel: 'whatsapp', accountId: 'work' } },
        { type: 'route', agentId: 'vip', match: { channel: 'whatsapp', accountId: 'work', peer: { kind: 'direct', id: '+1' } } },
        { type: 'acp', agentId: 'codex', match: { channel: 'whatsapp', accountId: 'work', peer: { kind: 'group', id: 'g' } } },
      ],
    });

    const next = addChannelAccount(original, 'whatsapp', 'work', {
      enabled: true,
      agentId: 'support',
    });

    assert.equal(next.channels?.whatsapp?.accounts?.work?.agentId, undefined);
    assert.equal(next.bindings?.filter((binding) => binding.agentId === 'support').length, 1);
    assert.equal(next.bindings?.some((binding) => binding.agentId === 'old'), false);
    assert.equal(next.bindings?.some((binding) => binding.agentId === 'vip'), true);
    assert.equal(next.bindings?.some((binding) => binding.type === 'acp'), true);
  });

  test('save migration converts every legacy agentId and removes modelByChannel', () => {
    const migrated = migrateLegacyChannelBindings(cfg({
      channels: {
        telegram: {
          agentId: 'main',
          accounts: { work: { agentId: 'support', botToken: 'token' } },
        },
        modelByChannel: { telegram: 'openai/gpt-5.6' },
      },
    }));
    assert.equal(migrated.channels?.telegram?.agentId, undefined);
    assert.equal(migrated.channels?.telegram?.accounts?.work?.agentId, undefined);
    assert.equal(migrated.channels?.modelByChannel, undefined);
    assert.deepEqual(migrated.bindings, [
      { type: 'route', agentId: 'main', match: { channel: 'telegram' } },
      { type: 'route', agentId: 'support', match: { channel: 'telegram', accountId: 'work' } },
    ]);
  });

  test('save migration repairs the retired dingtalk alias and credential fields', () => {
    const migrated = migrateLegacyChannelBindings(cfg({
      channels: {
        dingtalk: {
          appKey: 'client',
          appSecret: 'secret',
          robotCode: 'retired',
          callbackUrl: 'https://example.test/callback',
        },
      },
      bindings: [{ type: 'route', agentId: 'ops', match: { channel: 'dingtalk' } }],
    }));
    assert.equal(migrated.channels?.dingtalk, undefined);
    assert.deepEqual(migrated.channels?.['dingtalk-connector'], {
      clientId: 'client',
      clientSecret: 'secret',
      endpoint: 'https://example.test/callback',
    });
    assert.equal(migrated.bindings?.[0]?.match.channel, 'dingtalk-connector');
  });

  test('removeAgentChannelBindings clears channel and account bindings without touching other channels', () => {
    const original = cfg({
      channels: {
        feishu: {
          agentId: 'target',
          accounts: {
            one: { agentId: 'target', appId: 'a' },
            two: { agentId: 'other', appId: 'b' },
          },
        },
        telegram: {
          agentId: 'other',
          accounts: {
            default: { agentId: 'target', botToken: 't' },
          },
        },
        modelByChannel: { target: 'keep' },
      },
    });

    const { next, removed } = removeAgentChannelBindings(original, 'target');

    assert.equal(removed, 3);
    assert.equal(next.channels?.feishu?.agentId, undefined);
    assert.equal(next.channels?.feishu?.accounts?.one?.agentId, undefined);
    assert.equal(next.channels?.feishu?.accounts?.two?.agentId, 'other');
    assert.equal(next.channels?.telegram?.agentId, 'other');
    assert.equal(next.channels?.telegram?.accounts?.default?.agentId, undefined);
    assert.deepEqual(next.channels?.modelByChannel, { target: 'keep' });
    assert.equal(original.channels?.feishu?.agentId, 'target');
    assert.equal(original.channels?.feishu?.accounts?.one?.agentId, 'target');
  });

  test('persistChannelsOnlyWithRepository merges the latest disk config before writing', async () => {
    let written: GatewayRuntimeConfig | null = null;
    const repository: ChannelConfigRepository = {
      async detect() {
        return { path: '/tmp/openclaw.json', exists: true };
      },
      async read() {
        return cfg({
          agents: { list: [{ id: 'main' }] },
          providers: { openai: { apiKey: 'disk-value' } },
          channels: { telegram: { enabled: false } },
          bindings: [{ type: 'route', agentId: 'disk', match: { channel: 'telegram' } }],
        });
      },
      async write(_path, config) {
        written = config;
      },
      async restart() {
        return { success: true };
      },
    };

    const merged = await persistChannelsOnlyWithRepository(
      repository,
      '/tmp/openclaw.json',
      cfg({
        channels: { feishu: { enabled: true } },
        bindings: [{ type: 'route', agentId: 'main', match: { channel: 'feishu' } }],
      }),
    );

    assert.deepEqual(merged.channels, { feishu: { enabled: true } });
    assert.deepEqual(merged.bindings, [{ type: 'route', agentId: 'main', match: { channel: 'feishu' } }]);
    assert.deepEqual((merged as unknown as Record<string, unknown>).providers, { openai: { apiKey: 'disk-value' } });
    assert.deepEqual(written, merged);
  });

  test('official runtime readiness still requires an agent binding', () => {
    const account = {
      id: 'default',
      label: 'Default',
      enabled: true,
      source: 'channel' as const,
      config: { appId: 'id', appSecret: 'secret' },
    };
    assert.equal(
      assessChannelAccountReadiness('feishu', account, { configured: true, enabled: true }).state,
      'unbound',
    );
  });

  test('account editor values retain official root binding selection', () => {
    const values = channelAccountEditorValues({
      id: 'default',
      label: 'Default',
      enabled: true,
      agentId: 'main',
      source: 'channel',
      config: { appId: 'id' },
    });
    assert.equal(values.agentId, 'main');
  });

  test('upserting a channel-level account allows cleared fields to be removed', () => {
    const next = upsertChannelAccount(
      { channels: { feishu: { enabled: true, appId: 'old', appSecret: 'secret' } } },
      'feishu',
      { id: 'default', source: 'channel' },
      { enabled: true, appSecret: 'secret' },
    );
    assert.equal(next.channels?.feishu.appId, undefined);
    assert.equal(next.channels?.feishu.appSecret, 'secret');
  });
});
