import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addChannel,
  addChannelAccount,
  assessChannelAccountReadiness,
  buildChannelGroups,
  channelAccountEditorValues,
  getChannelAgentOptions,
  getRequiredCredentialFields,
  persistChannelsOnlyWithRepository,
  migrateLegacyChannelBindings,
  removeAgentChannelBindings,
  upsertChannelAccount,
  type ChannelConfigRepository,
} from './channelConfig';
import { CONFIG_REVISION_CONFLICT_PREFIX } from './channelConfigMerge';
import type { GatewayRuntimeConfig } from '@/types/openclawConfig';

function cfg(overrides: GatewayRuntimeConfig): GatewayRuntimeConfig {
  return overrides;
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
        defaults: { enabled: true },
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
    assert.equal(groups.some((group) => group.id === 'defaults'), false);
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

  test('non-DingTalk channels never use JunQi credential definitions or defaults', () => {
    assert.deepEqual(getRequiredCredentialFields('future-runtime-channel'), []);
    assert.deepEqual(
      addChannel(cfg({ channels: {} }), 'future-runtime-channel').channels?.['future-runtime-channel'],
      { enabled: true },
    );

    const account = buildChannelGroups(cfg({
      channels: { 'future-runtime-channel': { enabled: true, agentId: 'main' } },
    }))[0]?.accounts[0];
    assert.ok(account);
    assert.equal(assessChannelAccountReadiness('future-runtime-channel', account).state, 'unknown');
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

  test('new DingTalk channel drafts do not write retired streaming fields', () => {
    const next = addChannel(cfg({ channels: {} }), 'dingtalk-connector');
    assert.deepEqual(next.channels?.['dingtalk-connector'], { enabled: true });
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

  test('save migration converts legacy agent bindings and preserves channel metadata', () => {
    const migrated = migrateLegacyChannelBindings(cfg({
      channels: {
        telegram: {
          agentId: 'main',
          accounts: { work: { agentId: 'support', botToken: 'token' } },
        },
        defaults: { enabled: true },
        modelByChannel: { openai: { telegram: 'openai/gpt-5.6' } },
      },
    }));
    assert.equal(migrated.channels?.telegram?.agentId, undefined);
    assert.equal(migrated.channels?.telegram?.accounts?.work?.agentId, undefined);
    assert.deepEqual(migrated.channels?.defaults, { enabled: true });
    assert.deepEqual(migrated.channels?.modelByChannel, {
      openai: { telegram: 'openai/gpt-5.6' },
    });
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

  test('persistChannelsOnlyWithRepository preserves metadata and unrelated concurrent channel changes', async () => {
    let written: GatewayRuntimeConfig | null = null;
    const base = cfg({
      agents: { list: [{ id: 'main' }] },
      models: { providers: { openai: { apiKey: 'disk-value' } } },
      channels: {
        telegram: { enabled: false },
        defaults: { enabled: true },
        modelByChannel: { openai: { telegram: 'openai/gpt-5.6' } },
      },
      bindings: [{ type: 'route', agentId: 'main', match: { channel: 'telegram' } }],
    });
    const next = {
      ...base,
      channels: {
        ...base.channels,
        telegram: { enabled: true },
      },
    };
    const latest = cfg({
      ...base,
      channels: {
        ...base.channels,
        discord: { enabled: true },
      },
      bindings: [
        ...(base.bindings ?? []),
        { type: 'route', agentId: 'support', match: { channel: 'discord' } },
      ],
    });
    const repository: ChannelConfigRepository = {
      async detect() {
        return { path: '/tmp/openclaw.json', exists: true };
      },
      async read() {
        return { config: latest, revision: 'revision-1' };
      },
      async write(config, expectedRevision) {
        assert.equal(expectedRevision, 'revision-1');
        written = config;
      },
      async restart() {
        return { success: true };
      },
    };

    const merged = await persistChannelsOnlyWithRepository(
      repository,
      base,
      next,
    );

    assert.equal(merged.channels?.telegram?.enabled, true);
    assert.deepEqual(merged.channels?.discord, { enabled: true });
    assert.deepEqual(merged.channels?.defaults, { enabled: true });
    assert.deepEqual(merged.channels?.modelByChannel, {
      openai: { telegram: 'openai/gpt-5.6' },
    });
    assert.deepEqual(merged.bindings, latest.bindings);
    assert.deepEqual(merged.models?.providers?.openai, { apiKey: 'disk-value' });
    assert.deepEqual(written, merged);
  });

  test('persistChannelsOnlyWithRepository retries a revision conflict without losing concurrent changes', async () => {
    const base = cfg({
      channels: {
        telegram: { enabled: false },
        modelByChannel: { openai: { telegram: 'openai/gpt-5.6' } },
      },
      bindings: [{ type: 'route', agentId: 'main', match: { channel: 'telegram' } }],
    });
    const next = {
      ...base,
      channels: {
        ...base.channels,
        telegram: { enabled: true },
      },
    };
    let latest = base;
    let revision = 'revision-1';
    let writes = 0;
    const repository: ChannelConfigRepository = {
      async detect() {
        return { path: '/tmp/openclaw.json', exists: true };
      },
      async read() {
        return { config: latest, revision };
      },
      async write(candidate, expectedRevision) {
        assert.equal(expectedRevision, revision);
        writes += 1;
        if (writes === 1) {
          latest = {
            ...latest,
            channels: { ...latest.channels, discord: { enabled: true } },
            bindings: [
              ...(latest.bindings ?? []),
              { type: 'route', agentId: 'support', match: { channel: 'discord' } },
            ],
          };
          revision = 'revision-2';
          throw new Error(`${CONFIG_REVISION_CONFLICT_PREFIX}: stale revision`);
        }
        latest = candidate;
      },
      async restart() {
        return { success: true };
      },
    };

    const merged = await persistChannelsOnlyWithRepository(repository, base, next);

    assert.equal(writes, 2);
    assert.equal(merged.channels?.telegram?.enabled, true);
    assert.deepEqual(merged.channels?.discord, { enabled: true });
    assert.deepEqual(merged.channels?.modelByChannel, {
      openai: { telegram: 'openai/gpt-5.6' },
    });
    assert.equal(merged.bindings?.some((binding) => binding.match.channel === 'discord'), true);
  });

  test('runtime linked=false applies to any dynamically discovered channel', () => {
    const account = {
      id: 'default',
      label: 'Default',
      enabled: true,
      agentId: 'main',
      source: 'channel' as const,
      config: {},
    };
    assert.equal(
      assessChannelAccountReadiness('future-qr-channel', account, { configured: true, enabled: true, linked: false }).state,
      'missing_credentials',
    );
  });

  test('BUG-CRA-07 an account without an explicit binding routes to the Runtime default agent', () => {
    const account = {
      id: 'default',
      label: 'Default',
      enabled: true,
      source: 'channel' as const,
      config: { appId: 'id', appSecret: 'secret' },
    };
    assert.equal(
      assessChannelAccountReadiness('feishu', account, { configured: true, enabled: true }).state,
      'ready',
    );
  });

  test('BUG-CRA-07 binding options include OpenClaw implicit main and selected default agents', () => {
    assert.deepEqual(getChannelAgentOptions(cfg({ agents: { defaults: {} } })), [
      { id: 'main', name: 'main', isDefault: true },
    ]);
    assert.deepEqual(getChannelAgentOptions(cfg({
      agents: {
        list: [
          { id: 'research', name: 'Research' },
          { id: 'support', name: 'Support', default: true },
        ],
      },
    })), [
      { id: 'research', name: 'Research', isDefault: false },
      { id: 'support', name: 'Support', isDefault: true },
    ]);
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
