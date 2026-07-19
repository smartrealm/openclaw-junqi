import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenClawWizardFailure,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  isTerminalRenderedQrChoice,
  localizeOpenClawWizardStep,
  OpenClawWizardClient,
  requiresOpenClawOnboarding,
  supportedWizardOptions,
} from './openclawWizard';

test('requires onboarding for a missing or model-less config', () => {
  assert.equal(requiresOpenClawOnboarding(false, {}), true);
  assert.equal(requiresOpenClawOnboarding(true, { gateway: { mode: 'local' } }), true);
});

test('localizes the official setup-mode presentation without changing option values', () => {
  const step = {
    id: 'select-1',
    type: 'select' as const,
    title: 'Setup mode',
    options: [
      { value: 'keep-model', label: 'Keep existing model config', hint: 'Keep the current model.' },
      { value: 'quickstart', label: 'QuickStart (recommended)', hint: 'Local setup.' },
      { value: 'advanced', label: 'Manual setup', hint: 'Choose details.' },
      { value: 'import:claude', label: 'Import from Claude', hint: '/Users/example/.claude' },
    ],
  };
  const presented = localizeOpenClawWizardStep(step, (key) => `zh:${key}`);

  assert.equal(presented.title, 'zh:setup.wizard.setupMode.title');
  assert.deepEqual(presented.options?.map((option) => option.value), step.options.map((option) => option.value));
  assert.equal(presented.options?.[1]?.label, 'zh:setup.wizard.setupMode.quickstart.label');
  assert.equal(presented.options?.[3]?.hint, '/Users/example/.claude');
});

test('localizes known official wizard copy without changing its protocol shape', () => {
  const step = {
    id: 'channels-primer',
    type: 'note' as const,
    title: 'How channels work',
    message: 'Inbound DM safety defaults to pairing: unknown senders get a pairing code first.',
  };
  const presented = localizeOpenClawWizardStep(step, (key) => `zh:${key}`);

  assert.equal(presented.id, step.id);
  assert.equal(presented.type, step.type);
  assert.equal(presented.title, 'zh:setup.wizard.presentation.channelsPrimer');
  assert.equal(presented.message, 'zh:setup.wizard.presentation.channelsPrimerMessage');
});

test('accepts official wizard metadata or an existing default model', () => {
  assert.equal(requiresOpenClawOnboarding(true, { wizard: { lastRunAt: '2026-07-13T00:00:00Z' } }), false);
  assert.equal(requiresOpenClawOnboarding(true, { agents: { defaults: { model: { primary: 'openai/gpt-5' } } } }), false);
});

test('wizard client preserves dynamic option values and session lifecycle', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; options?: { timeoutMs?: number | null } }> = [];
  const client = new OpenClawWizardClient(async (method, params, options) => {
    calls.push({ method, params, ...(options ? { options } : {}) });
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-1',
        done: false,
        status: 'running',
        step: { id: 'provider', type: 'select', options: [{ label: 'Provider', value: { id: 'dynamic' } }] },
      };
    }
    return { done: true, status: 'done' };
  });

  const started = await client.start(' /tmp/workspace ');
  assert.deepEqual(started.step?.options?.[0].value, { id: 'dynamic' });
  await client.next('provider', { id: 'dynamic' });
  assert.deepEqual(calls, [
    { method: 'wizard.start', params: { mode: 'local', workspace: '/tmp/workspace' } },
    {
      method: 'wizard.next',
      params: { sessionId: 'session-1', answer: { stepId: 'provider', value: { id: 'dynamic' } } },
      options: { timeoutMs: null },
    },
  ]);
  await assert.rejects(() => client.next('provider', 'again'), /not running/);
});

test('wizard client restores an unfinished official session after a renderer restart', async () => {
  let storedSessionId: string | null = null;
  const store = {
    load: () => storedSessionId,
    save: (sessionId: string) => { storedSessionId = sessionId; },
    clear: () => { storedSessionId = null; },
  };
  const firstClient = new OpenClawWizardClient(async () => ({
    sessionId: 'persisted-session',
    done: false,
    status: 'running',
    step: { id: 'model', type: 'select' },
  }), store);

  await firstClient.start();
  assert.equal(storedSessionId, 'persisted-session');

  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const resumedClient = new OpenClawWizardClient(async (method, params) => {
    calls.push({ method, params });
    return { done: true, status: 'done' };
  }, store);
  await resumedClient.resume();

  assert.deepEqual(calls, [{ method: 'wizard.next', params: { sessionId: 'persisted-session' } }]);
  assert.equal(storedSessionId, null);
});

test('wizard client rejects malformed gateway responses', async () => {
  const client = new OpenClawWizardClient(async () => ({ status: 'running' }));
  await assert.rejects(() => client.start(), /missing `done`/);
});

test('recognizes only recoverable wizard session loss errors', () => {
  assert.equal(isOpenClawWizardSessionLost(new Error('wizard not found')), true);
  assert.equal(isOpenClawWizardSessionLost(new Error('Wizard not running')), true);
  assert.equal(isOpenClawWizardSessionLost(new Error('OpenClaw wizard session is not running.')), true);
  assert.equal(isOpenClawWizardSessionLost(new Error('provider authentication failed')), false);
  assert.equal(classifyOpenClawWizardFailure(new Error('wizard already running')), 'already_running');
  assert.equal(classifyOpenClawWizardFailure(new Error('Request timeout (120000ms)')), 'request_timeout');
});

test('resumes a desynchronized wizard without replaying an answer', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; options?: { timeoutMs?: number | null } }> = [];
  const client = new OpenClawWizardClient(async (method, params, options) => {
    calls.push({ method, params, ...(options ? { options } : {}) });
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-2',
        done: false,
        status: 'running',
        step: { id: 'initial', type: 'note' },
      };
    }
    return {
      done: false,
      status: 'running',
      step: { id: 'current', type: 'text' },
    };
  });

  await client.start();
  const resumed = await client.resume();

  assert.equal(resumed.step?.id, 'current');
  assert.deepEqual(calls[1], {
    method: 'wizard.next',
    params: { sessionId: 'session-2' },
    options: { timeoutMs: null },
  });
  assert.equal(isOpenClawWizardStepDesynchronized(new Error('wizard: no pending step')), true);
});

test('filters the terminal-only scan branch from the embedded wizard', () => {
  const step = {
    id: 'feishu-method',
    type: 'select' as const,
    initialValue: 'manual',
    options: [
      { value: 'manual', label: 'Manual' },
      { value: 'scan', label: 'Scan' },
    ],
  };

  assert.equal(isTerminalRenderedQrChoice(step), true);
  assert.deepEqual(supportedWizardOptions(step).map((option) => option.value), ['manual']);
});
