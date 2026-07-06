import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addChannelAccount,
  assessChannelAccountReadiness,
  buildChannelGroups,
  getRequiredCredentialFields,
  persistChannelsOnlyWithRepository,
  removeAgentChannelBindings,
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
      agentId: 'ops-agent',
    });
    assert.deepEqual(original.channels?.discord?.accounts, {
      default: { token: 'old', agentId: 'main' },
    });
  });

  test('dingtalk accounts require app credentials before they are ready', () => {
    assert.deepEqual(getRequiredCredentialFields('dingtalk'), ['appKey', 'appSecret', 'robotCode']);

    const [account] = buildChannelGroups(cfg({
      channels: {
        dingtalk: {
          enabled: true,
          accounts: {
            ops: {
              name: 'Ops DingTalk',
              enabled: true,
              agentId: 'ops-agent',
              appKey: 'key',
              robotCode: 'robot',
            },
          },
        },
      },
    })).flatMap((group) => group.accounts);

    assert.ok(account);
    assert.deepEqual(assessChannelAccountReadiness('dingtalk', account), {
      state: 'missing_credentials',
      missingFields: ['appSecret'],
      messages: ['missing_credentials'],
    });
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
      cfg({ channels: { feishu: { enabled: true } } }),
    );

    assert.deepEqual(merged.channels, { feishu: { enabled: true } });
    assert.deepEqual((merged as unknown as Record<string, unknown>).providers, { openai: { apiKey: 'disk-value' } });
    assert.deepEqual(written, merged);
  });
});
