import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawGuidedSetupClient,
  OpenClawGuidedSetupMethodUnavailableError,
  OpenClawGuidedSetupResponseError,
  parseGuidedSetupDetection,
} from './OpenClawGuidedSetupClient';

const detection = {
  candidates: [{
    kind: 'codex-cli',
    brandId: 'openai',
    label: 'Codex CLI',
    detail: 'Existing login',
    modelRef: 'openai/gpt-5.6-sol',
    recommended: true,
    credentials: true,
  }],
  unavailableCandidates: [],
  manualProviders: [{ id: 'openai', label: 'OpenAI' }],
  authOptions: [{ id: 'openai-oauth', label: 'OpenAI', kind: 'oauth', featured: true }],
  prepareOptions: [{ id: 'ollama', label: 'Ollama' }],
  recommendedInstalls: [],
  workspace: '/tmp/openclaw-workspace',
  setupComplete: false,
};

test('guided setup client uses the official setup and onboarding chat methods', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawGuidedSetupClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      if (method === 'openclaw.setup.detect') return detection;
      if (method === 'openclaw.setup.activate') {
        return { ok: true, modelRef: 'openai/gpt-5.6-sol', latencyMs: 200, lines: [] };
      }
      if (method === 'openclaw.setup.verify') {
        return { ok: true, modelRef: 'openai/gpt-5.6-sol', latencyMs: 180 };
      }
      if (method === 'openclaw.chat') {
        return {
          sessionId: 'chat-1',
          reply: 'Ready',
          action: 'none',
          question: {
            id: 'next',
            header: 'Next step',
            question: 'What should OpenClaw configure next?',
            options: [
              { label: 'Workspace', reply: 'Configure the workspace' },
              { label: 'Channels' },
            ],
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    },
  });

  assert.equal((await client.detect()).workspace, '/tmp/openclaw-workspace');
  assert.equal((await client.activate({
    kind: 'codex-cli',
    modelRef: 'openai/gpt-5.6-sol',
    workspace: '/tmp/openclaw-workspace',
  })).ok, true);
  assert.equal((await client.verify()).ok, true);
  const chat = await client.chat({ sessionId: 'chat-1', welcomeVariant: 'onboarding' });
  assert.equal(chat.reply, 'Ready');
  assert.equal(chat.question?.options[0]?.reply, 'Configure the workspace');
  assert.deepEqual(calls.map((call) => call.method), [
    'openclaw.setup.detect',
    'openclaw.setup.activate',
    'openclaw.setup.verify',
    'openclaw.chat',
  ]);
});

test('guided setup client rejects chat questions that drift from the official schema', async () => {
  const client = new OpenClawGuidedSetupClient({
    requestPrivileged: async () => ({
      sessionId: 'chat-1',
      reply: 'Ready',
      action: 'none',
      question: {
        id: 'next',
        header: 'Next step',
        options: [{ id: 'invented', label: 'Workspace' }],
      },
    }),
  });
  await assert.rejects(
    client.chat({ sessionId: 'chat-1' }),
    OpenClawGuidedSetupResponseError,
  );
});

test('guided setup detection preserves provider-owned structured options', () => {
  assert.deepEqual(parseGuidedSetupDetection(detection), detection);
  assert.throws(
    () => parseGuidedSetupDetection({ ...detection, setupComplete: 'yes' }),
    OpenClawGuidedSetupResponseError,
  );
  assert.throws(
    () => parseGuidedSetupDetection({ ...detection, candidates: [{ ...detection.candidates[0], kind: 'invented' }] }),
    OpenClawGuidedSetupResponseError,
  );
  assert.deepEqual(
    parseGuidedSetupDetection({
      ...detection,
      unavailableCandidates: undefined,
      recommendedInstalls: undefined,
    }).unavailableCandidates,
    [],
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      parseGuidedSetupDetection({ ...detection, codexAppServerDetected: true }),
      'codexAppServerDetected',
    ),
    false,
  );
});

test('guided setup detection accepts the current OpenClaw optional catalogs and setup kinds', () => {
  const parsed = parseGuidedSetupDetection({
    candidates: [{
      kind: 'saved-auth:deepseek%3Adefault',
      brandId: 'deepseek',
      label: 'Saved DeepSeek credential',
      detail: 'available',
      modelRef: 'deepseek/deepseek-v4-flash',
      recommended: false,
      credentials: true,
    }],
    manualProviders: [{
      id: 'deepseek-api-key',
      brandId: 'deepseek',
      groupLabel: 'DeepSeek',
      label: 'DeepSeek API key',
      hint: '',
    }],
    authOptions: [
      {
        id: 'anthropic-cli',
        brandId: 'anthropic',
        label: 'Anthropic Claude CLI',
        hint: 'Install and sign in on this Gateway host',
        groupLabel: 'Anthropic',
        kind: 'install',
        featured: true,
      },
      {
        id: 'custom-api-key',
        brandId: 'custom',
        label: 'Custom endpoint',
        groupLabel: '',
        kind: 'custom',
        featured: false,
      },
    ],
    nativeSessionCatalogs: [{
      pluginId: 'codex',
      label: 'Codex',
      detail: '',
    }],
    nativeSessionCatalogPreferenceRequired: false,
    workspace: '/tmp/openclaw-workspace',
    configuredModel: '',
    setupComplete: true,
  });

  assert.equal(parsed.candidates[0]?.kind, 'saved-auth:deepseek%3Adefault');
  assert.deepEqual(parsed.unavailableCandidates, []);
  assert.deepEqual(parsed.recommendedInstalls, []);
  assert.equal(parsed.authOptions[0]?.kind, 'install');
  assert.equal(parsed.authOptions[1]?.kind, 'custom');
  assert.equal(parsed.nativeSessionCatalogs?.[0]?.pluginId, 'codex');
  assert.equal(parsed.nativeSessionCatalogPreferenceRequired, false);
  assert.equal(parsed.configuredModel, '');
});

test('guided setup client classifies the official setup method as unavailable', async () => {
  const client = new OpenClawGuidedSetupClient({
    requestPrivileged: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  await assert.rejects(client.detect(), (error: unknown) => (
    error instanceof OpenClawGuidedSetupMethodUnavailableError
    && error.method === 'openclaw.setup.detect'
  ));
});

test('guided setup client starts provider-owned auth and prepare wizard sessions', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawGuidedSetupClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return { sessionId: String(params.sessionId), done: false, status: 'running' };
    },
  });
  assert.equal((await client.startAuth({
    sessionId: 'auth-1',
    authChoice: 'openai-oauth',
    workspace: '/tmp/openclaw-workspace',
  })).sessionId, 'auth-1');
  assert.equal((await client.startPrepare({
    sessionId: 'prepare-1',
    authChoice: 'ollama',
    workspace: '/tmp/openclaw-workspace',
  })).sessionId, 'prepare-1');
  assert.deepEqual(calls.map((call) => call.method), [
    'openclaw.setup.auth.start',
    'openclaw.setup.prepare.start',
  ]);
});

test('guided setup chat forwards the official embedded wizard cancellation', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawGuidedSetupClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return { sessionId: 'chat-1', reply: 'Cancelled', action: 'none' };
    },
  });
  await client.chat({ sessionId: 'chat-1', wizardCancel: { stepId: 'provider-auth' } });
  assert.deepEqual(calls, [{
    method: 'openclaw.chat',
    params: { sessionId: 'chat-1', wizardCancel: { stepId: 'provider-auth' } },
  }]);
});
