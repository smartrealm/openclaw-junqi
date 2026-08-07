import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_TEMPLATES, UI_CATALOG, getTemplateById } from './providerTemplates';
import { AUTH_MODE_ORDER } from '@/types/providerAuthMode';

test('provider templates only use current JunQi auth modes', () => {
  const allowed = new Set(AUTH_MODE_ORDER);
  for (const template of PROVIDER_TEMPLATES) {
    assert.ok(allowed.has(template.defaultAuthMode), `${template.id} has invalid default auth mode`);
    for (const mode of template.authModes) {
      assert.ok(allowed.has(mode), `${template.id} has invalid auth mode ${mode}`);
    }
  }
});

test('provider template protocol suggestions are non-empty opaque Runtime values', () => {
  for (const template of PROVIDER_TEMPLATES) {
    if (template.api === undefined) continue;
    assert.ok(template.api.trim(), `${template.id} has a blank protocol suggestion`);
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
