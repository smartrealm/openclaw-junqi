import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_TEMPLATES, UI_CATALOG, getTemplateById } from './providerTemplates';
import { OPENCLAW_API_PROTOCOLS } from '@/types/openclawApiProtocol';
import { AUTH_MODE_ORDER } from '@/types/providerAuthMode';
import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';

test('provider templates only use current JunQi auth modes', () => {
  const allowed = new Set(AUTH_MODE_ORDER);
  for (const template of PROVIDER_TEMPLATES) {
    assert.ok(allowed.has(template.defaultAuthMode), `${template.id} has invalid default auth mode`);
    for (const mode of template.authModes) {
      assert.ok(allowed.has(mode), `${template.id} has invalid auth mode ${mode}`);
    }
  }
});

test('provider templates only use OpenClaw runtime API protocols', () => {
  const allowed = new Set(OPENCLAW_API_PROTOCOLS);
  for (const template of PROVIDER_TEMPLATES) {
    if (!template.api) continue;
    assert.ok(allowed.has(template.api), `${template.id} has invalid api protocol ${template.api}`);
  }
});

test('official OpenAI and Google templates use their matching runtime protocols', () => {
  assert.equal(getTemplateById('openai')?.api, 'openai-completions');
  assert.equal(getTemplateById('google')?.api, 'google-generative-ai');
});

test('provider UI catalog entries all resolve to templates', () => {
  for (const entry of UI_CATALOG) {
    assert.ok(getTemplateById(entry.templateId), `${entry.catalogId} references missing template ${entry.templateId}`);
  }
});

test('generated provider catalog coverage matches intentional runtime aliases', () => {
  const generatedIds = new Set(Object.keys(GENERATED_PROVIDER_CATALOG));
  const missing = PROVIDER_TEMPLATES
    .map((template) => template.id)
    .filter((id) => !generatedIds.has(id));
  assert.deepEqual(missing, ['modelstudio']);
  assert.ok(generatedIds.has('qwen'), 'modelstudio runtime catalog should be exposed under qwen');
});
