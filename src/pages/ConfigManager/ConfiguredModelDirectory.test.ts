import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildConfiguredModelGroups } from './ConfiguredModelDirectory';

test('configured model directory groups and sorts model references by provider namespace', () => {
  const groups = buildConfiguredModelGroups({
    'minimax/MiniMax-M2.7': { alias: 'minimax-fast' },
    'deepseek/deepseek-v4-pro': {},
    'deepseek/deepseek-chat': {},
  });

  assert.deepEqual(groups.map((group) => ({
    providerId: group.providerId,
    models: group.models.map(({ modelId, reference }) => ({ modelId, reference })),
  })), [
    {
      providerId: 'deepseek',
      models: [
        { modelId: 'deepseek-chat', reference: 'deepseek/deepseek-chat' },
        { modelId: 'deepseek-v4-pro', reference: 'deepseek/deepseek-v4-pro' },
      ],
    },
    {
      providerId: 'minimax',
      models: [
        { modelId: 'MiniMax-M2.7', reference: 'minimax/MiniMax-M2.7' },
      ],
    },
  ]);
});

test('configured model directory keeps malformed references visible instead of dropping them', () => {
  const groups = buildConfiguredModelGroups({ 'local-model': {} });

  assert.deepEqual(groups.map((group) => ({
    providerId: group.providerId,
    models: group.models.map(({ modelId }) => modelId),
  })), [
    { providerId: 'local-model', models: ['local-model'] },
  ]);
});

test('configured model directory labels are complete strings in every supported locale', () => {
  const keys = [
    'configuredModelCount',
    'modelName',
    'modelAlias',
    'modelRole',
    'modelActions',
    'noModelRole',
    'removeModel',
  ];

  for (const locale of ['en', 'zh', 'zh-TW']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), 'utf8'),
    ).config as Record<string, unknown>;

    for (const key of keys) {
      assert.equal(typeof messages[key], 'string', `${locale} is missing config.${key}`);
      assert.notEqual(String(messages[key]).trim(), '', `${locale} has an empty config.${key}`);
    }
  }
});
