import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GENERATED_PROVIDER_CATALOG,
  GENERATED_PROVIDER_CATALOG_META,
} from '@/generated/providerCatalog.generated';

test('BUG-MP-04 catalog records its official OpenClaw source and current baseline models', () => {
  assert.equal(GENERATED_PROVIDER_CATALOG_META.source, 'openclaw-cli');
  assert.match(GENERATED_PROVIDER_CATALOG_META.version ?? '', /2026\.7\.1/);
  assert.ok(GENERATED_PROVIDER_CATALOG.openai.some((entry) => entry.id === 'openai/gpt-5.6'));
  assert.ok(GENERATED_PROVIDER_CATALOG.anthropic.some((entry) => entry.id === 'anthropic/claude-sonnet-5'));
  assert.ok(GENERATED_PROVIDER_CATALOG.xai.some((entry) => entry.id === 'xai/grok-4.3'));
});

test('moonshot catalog stays separate from Kimi Coding', () => {
  const moonshotModels = (GENERATED_PROVIDER_CATALOG.moonshot ?? []).map((entry) => entry.id);
  const kimiCodingModels = (GENERATED_PROVIDER_CATALOG['kimi-coding'] ?? []).map((entry) => entry.id);

  assert.ok(moonshotModels.length > 0);
  assert.ok(moonshotModels.every((id) => id.startsWith('moonshot/')));
  assert.ok(moonshotModels.includes('moonshot/kimi-k2.6'));
  assert.deepEqual(kimiCodingModels, ['kimi-coding/k2p5']);
  assert.ok(!moonshotModels.includes('moonshot/k2p5'));
  assert.ok(!moonshotModels.some((id) => id.startsWith('kimi-coding/')));
});
