import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import {
  normalizeCustomProviderIcon,
  parseProviderAppearances,
  providerDisplayLabel,
  providerFallbackGlyph,
  resolveOfficialProviderIconName,
} from './index';

test('provider identity follows OpenClaw official icon aliases', () => {
  assert.equal(resolveOfficialProviderIconName('openai'), 'codex');
  assert.equal(resolveOfficialProviderIconName('anthropic'), 'claude');
  assert.equal(resolveOfficialProviderIconName('google-gemini-cli'), 'gemini');
  assert.equal(resolveOfficialProviderIconName('volcengine'), 'doubao');
  assert.equal(resolveOfficialProviderIconName('xiaomi'), 'mimo');
  assert.equal(resolveOfficialProviderIconName('private-vllm'), null);
});

test('provider labels preserve official spelling and derive unknown labels', () => {
  assert.equal(providerDisplayLabel('openai'), 'OpenAI');
  assert.equal(providerDisplayLabel('my-private_provider'), 'My Private Provider');
  assert.equal(providerFallbackGlyph('my-private-provider'), 'M');
});

test('custom provider appearances are bounded and reject malformed storage', () => {
  assert.equal(normalizeCustomProviderIcon('  VL  '), 'VL');
  assert.equal(normalizeCustomProviderIcon('123456789'), '12345678');
  assert.deepEqual(parseProviderAppearances('{broken'), {});
  assert.deepEqual(parseProviderAppearances(JSON.stringify({
    ' Private-VLLM ': { icon: ' V ' },
    empty: { icon: '' },
    invalid: 'x',
  })), {
    'private-vllm': { icon: 'V' },
  });
});

test('every bundled OpenClaw provider icon is addressable by the identity resolver', async () => {
  const iconDirectory = new URL('../../../../public/provider-icons/', import.meta.url);
  const files = (await readdir(iconDirectory))
    .filter((file) => /^ProviderIcon-[a-z0-9]+\.svg$/u.test(file));

  assert.equal(files.length, 52);
  for (const file of files) {
    const iconName = file.slice('ProviderIcon-'.length, -'.svg'.length);
    assert.equal(resolveOfficialProviderIconName(iconName), iconName);
  }
});
