import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getExplicitProviderModelRefs,
  hasBlockingModelRoutingIssue,
  inspectModelRouting,
} from './modelRoutingHealth';

test('replace mode is unhealthy when no explicit provider models are configured', () => {
  const health = inspectModelRouting({
    models: { mode: 'replace' },
    agents: { defaults: { model: { primary: 'openai/gpt-5' }, models: { 'openai/gpt-5': {} } } },
  });

  assert.equal(hasBlockingModelRoutingIssue(health), true);
  assert.deepEqual(health.issues.map((issue) => issue.kind), [
    'replace-without-explicit-models',
    'replace-primary-not-explicit',
  ]);
});

test('replace mode checks primary and ordered fallbacks against provider declarations', () => {
  const health = inspectModelRouting({
    models: {
      mode: 'replace',
      providers: {
        openai: { models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] },
      },
    },
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-5', fallbacks: ['openai/gpt-5-mini', 'anthropic/claude'] },
        models: {
          'openai/gpt-5': {},
          'openai/gpt-5-mini': {},
          'anthropic/claude': {},
        },
      },
    },
  });

  assert.deepEqual(getExplicitProviderModelRefs({
    models: { providers: { openai: { models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] } } },
  }), ['openai/gpt-5', 'openai/gpt-5-mini']);
  assert.deepEqual(health.issues, [{
    kind: 'replace-fallback-not-explicit',
    severity: 'error',
    refs: ['anthropic/claude'],
  }]);
});

test('model policy preview recognizes aliases and provider wildcards without changing routing', () => {
  const health = inspectModelRouting({
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-5' },
        models: {
          'openai/gpt-5': { alias: 'quality' },
          'openai/gpt-5-mini': {},
          'anthropic/claude': {},
        },
        modelPolicy: { allow: ['quality', 'anthropic/*'] },
      },
    },
  });

  assert.deepEqual(health.allowedConfiguredModels, ['anthropic/claude', 'openai/gpt-5']);
  assert.deepEqual(health.issues, []);
});
