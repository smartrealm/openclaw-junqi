import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManualGatewayRescueTarget,
  resolveGatewayRescueTarget,
  resolveGatewayRescueTargets,
} from './gatewayRescue';

test('resolveGatewayRescueTarget resolves OpenAI-compatible provider from primary model', () => {
  const target = resolveGatewayRescueTarget({
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-4o-mini' },
      },
    },
    models: {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '${OPENAI_API_KEY}',
        },
      },
    },
    env: {
      vars: {
        OPENAI_API_KEY: 'sk-test',
      },
    },
  } as any);

  assert.equal(target?.api, 'openai-compatible');
  assert.equal(target?.providerId, 'openai');
  assert.equal(target?.modelId, 'gpt-4o-mini');
  assert.equal(target?.apiKey, 'sk-test');
});

test('resolveGatewayRescueTarget resolves Anthropic Messages provider', () => {
  const target = resolveGatewayRescueTarget({
    agents: {
      defaults: {
        model: { primary: 'anthropic/claude-sonnet-4-6' },
      },
    },
    models: {
      providers: {
        anthropic: {
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: '${ANTHROPIC_API_KEY}',
        },
      },
    },
    env: {
      vars: {
        ANTHROPIC_API_KEY: 'sk-ant-test',
      },
    },
  } as any);

  assert.equal(target?.api, 'anthropic-messages');
  assert.equal(target?.providerId, 'anthropic');
  assert.equal(target?.modelId, 'claude-sonnet-4-6');
});

test('resolveGatewayRescueTarget returns null without readable secret value', () => {
  const target = resolveGatewayRescueTarget({
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-4o-mini' },
      },
    },
    models: {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '${OPENAI_API_KEY}',
        },
      },
    },
  } as any);

  assert.equal(target, null);
});

test('resolveGatewayRescueTarget ignores unsupported provider protocols', () => {
  const target = resolveGatewayRescueTarget({
    agents: {
      defaults: {
        model: { primary: 'google/gemini-2.5-pro' },
      },
    },
    models: {
      providers: {
        google: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: '${GEMINI_API_KEY}',
        },
      },
    },
    env: {
      vars: {
        GEMINI_API_KEY: 'gemini-test',
      },
    },
  } as any);

  assert.equal(target, null);
});

test('resolveGatewayRescueTargets falls back to configured providers when primary model is broken', () => {
  const targets = resolveGatewayRescueTargets({
    agents: {
      defaults: {
        model: { primary: 'missing-provider/dead-model' },
      },
    },
    models: {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '${OPENAI_API_KEY}',
        },
      },
    },
    env: {
      vars: {
        OPENAI_API_KEY: 'sk-test',
      },
    },
  } as any);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].providerId, 'openai');
  assert.equal(targets[0].source, 'configured-provider');
});

test('resolveGatewayRescueTargets reads provider config despite provider key case drift', () => {
  const targets = resolveGatewayRescueTargets({
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-4o-mini' },
      },
    },
    models: {
      providers: {
        OpenAI: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '${OPENAI_API_KEY}',
        },
      },
    },
    env: {
      vars: {
        OPENAI_API_KEY: 'sk-case',
      },
    },
  } as any);

  assert.equal(targets[0]?.providerId, 'openai');
  assert.equal(targets[0]?.apiKey, 'sk-case');
});

test('resolveGatewayRescueTargets deduplicates primary and configured model candidates', () => {
  const targets = resolveGatewayRescueTargets({
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-4o-mini' },
        models: {
          'openai/gpt-4o-mini': {},
        },
      },
    },
    models: {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'raw-key',
        },
      },
    },
  } as any);

  const matching = targets.filter((target) => target.modelRef === 'openai/gpt-4o-mini');
  assert.equal(matching.length, 1);
  assert.equal(matching[0].source, 'primary');
});

test('buildManualGatewayRescueTarget creates a temporary target without config dependency', () => {
  const target = buildManualGatewayRescueTarget({
    api: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: 'temp-key',
    modelId: 'rescue-model',
  });

  assert.equal(target?.providerId, 'manual');
  assert.equal(target?.source, 'manual');
  assert.equal(target?.modelId, 'rescue-model');
});

test('buildManualGatewayRescueTarget rejects incomplete temporary config', () => {
  assert.equal(buildManualGatewayRescueTarget({
    api: 'openai-compatible',
    baseUrl: '',
    apiKey: 'temp-key',
    modelId: 'rescue-model',
  }), null);
  assert.equal(buildManualGatewayRescueTarget({
    api: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: '',
    modelId: 'rescue-model',
  }), null);
  assert.equal(buildManualGatewayRescueTarget({
    api: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: 'temp-key',
    modelId: '',
  }), null);
});
