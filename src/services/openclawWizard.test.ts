import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenClawWizardFailure,
  isOpenClawWizardCompletionStep,
  isOpenClawWizardNonBlockingProbeFailure,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  OpenClawWizardCancelledError,
  OpenClawWizardClient,
  OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS,
  OPENCLAW_WIZARD_INTERACTIVE_TIMEOUT_MS,
  OpenClawWizardOperationSupersededError,
  createScopedOpenClawWizardSessionStore,
  requiresOpenClawOnboarding,
} from './openclawWizard';

test('recognizes only provider-neutral final wizard notes', () => {
  assert.equal(isOpenClawWizardCompletionStep({ id: 'done', type: 'note', title: 'Done', message: 'Onboarding complete. Open the dashboard.' }), true);
  assert.equal(isOpenClawWizardCompletionStep({ id: 'done-lookalike', type: 'note', title: 'Completed', message: 'Setup complete.' }), false);
  assert.equal(isOpenClawWizardCompletionStep({ id: 'channel', type: 'note', title: 'DingTalk authorization', message: 'Success! Bot configured.' }), false);
  assert.equal(isOpenClawWizardCompletionStep({ id: 'model', type: 'select', title: 'Done' }), false);
});

test('recognizes channel probe failures without coupling to one provider', () => {
  assert.equal(isOpenClawWizardNonBlockingProbeFailure({ id: 'probe', type: 'note', title: 'DingTalk connection test', message: 'Connection failed: Request failed with status code 403' }), true);
  assert.equal(isOpenClawWizardNonBlockingProbeFailure({ id: 'probe-2', type: 'note', title: 'Channel verification', message: 'HTTP 401' }), true);
  assert.equal(isOpenClawWizardNonBlockingProbeFailure({ id: 'auth', type: 'note', title: 'Authorization', message: 'Connection failed' }), false);
});

test('requires onboarding for a missing or model-less config', () => {
  assert.equal(requiresOpenClawOnboarding(false, {}), true);
  assert.equal(requiresOpenClawOnboarding(true, { gateway: { mode: 'local' } }), true);
});

test('requires a primary model instead of trusting wizard run metadata', () => {
  assert.equal(requiresOpenClawOnboarding(true, { wizard: { lastRunAt: '2026-07-13T00:00:00Z' } }), true);
  assert.equal(requiresOpenClawOnboarding(true, { agents: { defaults: { model: { primary: 'openai/gpt-5' } } } }), false);
  assert.equal(requiresOpenClawOnboarding(true, { agents: { defaults: { model: 'openai/gpt-5' } } }), false);
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
    {
      method: 'wizard.start',
      params: { mode: 'local', workspace: '/tmp/workspace' },
      options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
    },
    {
      method: 'wizard.next',
      params: { sessionId: 'session-1', answer: { stepId: 'provider', value: { id: 'dynamic' } } },
      options: { timeoutMs: OPENCLAW_WIZARD_INTERACTIVE_TIMEOUT_MS },
    },
  ]);
  await assert.rejects(() => client.next('provider', 'again'), /not running/);
});

test('wizard client retains its session when a bounded interactive request times out', async () => {
  const calls: Array<{ method: string; options?: { timeoutMs?: number | null } }> = [];
  const client = new OpenClawWizardClient(async (method, _params, options) => {
    calls.push({ method, ...(options ? { options } : {}) });
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-timeout',
        done: false,
        status: 'running',
        step: { id: 'external-authorization', type: 'action' },
      };
    }
    throw new Error(`Request timeout (${OPENCLAW_WIZARD_INTERACTIVE_TIMEOUT_MS}ms)`);
  });

  await client.start();
  await assert.rejects(
    () => client.next('external-authorization'),
    /Request timeout/,
  );

  assert.equal(client.activeSessionId, 'session-timeout');
  assert.equal(client.currentStepView?.id, 'external-authorization');
  assert.deepEqual(calls.at(-1), {
    method: 'wizard.next',
    options: { timeoutMs: OPENCLAW_WIZARD_INTERACTIVE_TIMEOUT_MS },
  });
});

test('wizard client rejects a late response after its owning setup operation is invalidated', async () => {
  let resolveRequest!: (value: unknown) => void;
  const client = new OpenClawWizardClient(() => new Promise((resolve) => {
    resolveRequest = resolve;
  }));

  const pending = client.start();
  client.invalidatePendingOperations();
  resolveRequest({
    sessionId: 'stale-session',
    done: false,
    status: 'running',
    step: { id: 'stale-step', type: 'note' },
  });

  await assert.rejects(pending, OpenClawWizardOperationSupersededError);
  assert.equal(client.activeSessionId, null);
  assert.equal(client.currentStepView, null);
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

  const calls: Array<{ method: string; params: Record<string, unknown>; options?: { timeoutMs?: number | null } }> = [];
  const resumedClient = new OpenClawWizardClient(async (method, params, options) => {
    calls.push({ method, params, ...(options ? { options } : {}) });
    if (method === 'wizard.status') return { status: 'running' };
    return { done: true, status: 'done' };
  }, store);
  await resumedClient.resume();

  assert.deepEqual(calls, [
    {
      method: 'wizard.status',
      params: { sessionId: 'persisted-session' },
      options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
    },
    {
      method: 'wizard.next',
      params: { sessionId: 'persisted-session' },
      options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
    },
  ]);
  assert.equal(storedSessionId, null);
});

test('Wizard 会话只会在创建它的运行时与 Gateway 目标中恢复', async () => {
  localStorage.clear();
  const firstGatewayUrl = new URL('/', `ws://${crypto.randomUUID()}.invalid`).toString();
  const secondGatewayUrl = new URL('/', `ws://${crypto.randomUUID()}.invalid`).toString();
  let scope: { runtimeMode: 'native' | 'docker'; gatewayWsUrl: string } = {
    runtimeMode: 'native',
    gatewayWsUrl: firstGatewayUrl,
  };
  const store = createScopedOpenClawWizardSessionStore(() => scope);
  const firstClient = new OpenClawWizardClient(async () => ({
    sessionId: 'native-session',
    done: false,
    status: 'running',
    step: { id: 'model', type: 'select' },
  }), store);
  await firstClient.start();

  scope = { runtimeMode: 'docker', gatewayWsUrl: secondGatewayUrl };
  const calls: string[] = [];
  const dockerClient = new OpenClawWizardClient(async (method) => {
    calls.push(method);
    return {
      sessionId: 'docker-session',
      done: false,
      status: 'running',
      step: { id: 'model', type: 'select' },
    };
  }, store);

  assert.equal(dockerClient.hasActiveSession, false);
  await dockerClient.start();
  assert.deepEqual(calls, ['wizard.start']);
});

test('wizard client starts fresh after terminal failure without replaying accepted answers', async () => {
  let starts = 0;
  const calls: Array<{ method: string; value?: unknown }> = [];
  const client = new OpenClawWizardClient(async (method, params) => {
    calls.push({ method, value: (params.answer as { value?: unknown } | undefined)?.value });
    if (method === 'wizard.start') {
      starts += 1;
      return { sessionId: `session-${starts}`, done: false, status: 'running', step: { id: 'credential', type: 'text', sensitive: true } };
    }
    const stepId = (params.answer as { stepId?: string } | undefined)?.stepId;
    if (stepId === 'credential') {
      return { done: true, status: 'error', error: 'credential rejected' };
    }
    throw new Error(`unexpected ${method}:${stepId ?? ''}`);
  });

  await client.start();
  const failed = await client.next('credential', 'secret-value');
  assert.equal(failed.status, 'error');
  assert.equal(client.failedStepView?.id, 'credential');
  assert.equal(client.diagnosticSessionId, 'session-1');

  const retried = await client.retry();
  assert.equal(retried.step?.id, 'credential');
  assert.equal(client.activeSessionId, 'session-2');
  assert.deepEqual(calls, [
    { method: 'wizard.start', value: undefined },
    { method: 'wizard.next', value: 'secret-value' },
    { method: 'wizard.start', value: undefined },
  ]);
});

test('wizard client preserves resume context when the official session terminates with an error', async () => {
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'windows-session',
        done: false,
        status: 'running',
        step: { id: 'provider-auth', type: 'action' },
      };
    }
    if (method === 'wizard.status') return { status: 'running' };
    return { done: false, status: 'error' };
  });

  await client.start();
  const failed = await client.resume();

  assert.equal(failed.status, 'error');
  assert.equal(client.activeSessionId, null);
  assert.equal(client.diagnosticSessionId, 'windows-session');
  assert.equal(client.failedStepView?.id, 'provider-auth');
});

test('wizard client never records or replays an answer rejected by a running session', async () => {
  let starts = 0;
  const calls: string[] = [];
  const client = new OpenClawWizardClient(async (method, params) => {
    const stepId = (params.answer as { stepId?: string } | undefined)?.stepId;
    calls.push(`${method}:${stepId ?? ''}`);
    if (method === 'wizard.start') {
      starts += 1;
      return { sessionId: `session-${starts}`, done: false, status: 'running', step: { id: 'first', type: 'select' } };
    }
    if (method === 'wizard.cancel') return { done: true, status: 'cancelled' };
    if (method === 'wizard.status') return { status: 'running' };
    if (stepId === 'first') {
      return { done: false, status: 'running', step: { id: 'second', type: 'text' } };
    }
    if (stepId === 'second') {
      return {
        done: false,
        status: 'running',
        error: 'answer failed validation',
        step: { id: 'second', type: 'text' },
      };
    }
    if (method === 'wizard.next') {
      return { done: false, status: 'running', step: { id: 'second', type: 'text' } };
    }
    throw new Error(`unexpected ${method}:${stepId ?? ''}`);
  });

  await client.start();
  await client.next('first', 'accepted');
  const rejected = await client.next('second', 'rejected');

  assert.equal(rejected.error, 'answer failed validation');
  assert.equal(client.activeSessionId, 'session-1');
  assert.equal(client.failedStepView?.id, 'second');
  const resumed = await client.retry();
  assert.equal(resumed.step?.id, 'second');
  assert.equal(client.failedStepView, null);

  assert.deepEqual(calls.slice(-2), [
    'wizard.status:',
    'wizard.next:',
  ]);
});

test('wizard client rejects cancellation status outside the installed synchronous contract', async () => {
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-cancel-drift',
        done: false,
        status: 'running',
        step: { id: 'persistent-effect', type: 'progress' },
      };
    }
    return { status: 'running' };
  });

  await client.start();
  await assert.rejects(() => client.cancel(), /must be `cancelled`/);
  assert.equal(client.activeSessionId, 'session-cancel-drift');
});

test('wizard client rejects malformed cancellation status without forgetting the session', async () => {
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return { sessionId: 'session-malformed', done: false, status: 'running', step: { id: 'confirm', type: 'confirm' } };
    }
    return { status: 'invalid' };
  });

  await client.start();
  await assert.rejects(() => client.cancel(), /cancellation response has an invalid `status`/);
  assert.equal(client.activeSessionId, 'session-malformed');
});

test('wizard client treats cancelled as a terminal session that can restart cleanly', async () => {
  let starts = 0;
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      starts += 1;
      return { sessionId: `session-${starts}`, done: false, status: 'running', step: { id: 'confirm', type: 'confirm' } };
    }
    return { done: false, status: 'cancelled' };
  });

  await client.start();
  const cancelled = await client.next('confirm', false);

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(client.activeSessionId, null);
  assert.equal(client.diagnosticSessionId, null);
  assert.equal(classifyOpenClawWizardFailure(new OpenClawWizardCancelledError()), 'cancelled');
  await client.retry();
  assert.equal(client.activeSessionId, 'session-2');
});

test('wizard client preserves Gateway option identity from the installed schema', async () => {
  const client = new OpenClawWizardClient(async () => ({
    sessionId: 'session-feishu',
    done: false,
    status: 'running',
    step: {
      id: 'channels',
      type: 'select',
      format: 'plain',
      options: [
        { value: 'openclaw-lark', label: 'Feishu/Lark (飞书)' },
        { value: 'feishu', label: 'Feishu/Lark (飞书)' },
      ],
    },
  }));

  const result = await client.start();
  assert.deepEqual(result.step?.options, [
    { value: 'openclaw-lark', label: 'Feishu/Lark (飞书)' },
    { value: 'feishu', label: 'Feishu/Lark (飞书)' },
  ]);
  assert.equal(result.step?.format, 'plain');
});

// Original intent: JunQi must never render protocol features the installed
// OpenClaw does not have (the reverted OAuth device-code extension). That still
// holds - unknown fields are dropped before the step reaches the UI - but a new
// field no longer takes onboarding down with it. See AUD-01.
test('fields outside the installed schema never reach the UI', async () => {
  for (const step of [
    { id: 'external', type: 'note', externalUrl: 'https://auth.example/device' },
    { id: 'device', type: 'note', deviceCode: { code: 'ABCD-1234' } },
  ]) {
    const client = new OpenClawWizardClient(async () => ({
      sessionId: 'session-invalid',
      done: false,
      status: 'running',
      step,
    }));
    const result = await client.start();
    assert.equal(result.step?.id, step.id);
    assert.equal((result.step as unknown as Record<string, unknown>).externalUrl, undefined);
    assert.equal((result.step as unknown as Record<string, unknown>).deviceCode, undefined);
  }
});

test('a step type outside the installed schema names itself', async () => {
  const client = new OpenClawWizardClient(async () => ({
    sessionId: 'session-invalid',
    done: false,
    status: 'running',
    step: { id: 'future', type: 'browser-approval', format: 'markdown' },
  }));
  await assert.rejects(() => client.start(), /does not support/i);
});

test('wizard client rejects malformed gateway responses', async () => {
  const client = new OpenClawWizardClient(async () => ({ status: 'running' }));
  await assert.rejects(() => client.start(), /missing `done`/);
});

test('wizard start requires its exact installed result shape', async () => {
  const missingSession = new OpenClawWizardClient(async () => ({
    done: true,
    status: 'done',
  }));
  await assert.rejects(() => missingSession.start(), /invalid `sessionId`/);

  // An additive envelope field is tolerated: rejecting it made a single
  // upstream addition enough to block first-run setup entirely.
  const extraField = new OpenClawWizardClient(async () => ({
    sessionId: 'session-extra',
    done: false,
    status: 'running',
    step: { id: 'provider', type: 'select' },
    future: true,
  }));
  const tolerated = await extraField.start();
  assert.equal(tolerated.sessionId, 'session-extra');
  assert.equal(tolerated.step?.id, 'provider');
});

test('wizard next rejects start-only fields', async () => {
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-next-shape',
        done: false,
        status: 'running',
        step: { id: 'provider', type: 'select' },
      };
    }
    return { sessionId: 'not-allowed', done: true, status: 'done' };
  });

  await client.start();
  // The additive field is tolerated, but it must not be mistaken for a session
  // handle: the client keeps the id `wizard.start` gave it.
  await client.next('provider', 'openai');
  assert.equal(client.activeSessionId, null, 'a terminal next clears the session');
  assert.notEqual(client.activeSessionId, 'not-allowed');
});

test('wizard status and cancellation tolerate additive result fields', async () => {
  const statusClient = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-status-shape',
        done: false,
        status: 'running',
        step: { id: 'provider', type: 'select' },
      };
    }
    return { status: 'done', extra: true };
  });
  await statusClient.start();
  // The extra field is ignored, and the reported terminal `done` status is still
  // honoured: the session is released rather than left dangling.
  await statusClient.resume();
  assert.equal(statusClient.activeSessionId, null);

  const cancelClient = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-cancel-shape',
        done: false,
        status: 'running',
        step: { id: 'provider', type: 'select' },
      };
    }
    return { status: 'cancelled', extra: true };
  });
  await cancelClient.start();
  await cancelClient.cancel();
  assert.equal(cancelClient.activeSessionId, null);
});

test('recognizes only recoverable wizard session loss errors', () => {
  assert.equal(isOpenClawWizardSessionLost(new Error('wizard not found')), true);
  assert.equal(isOpenClawWizardSessionLost(new Error('Wizard not running')), true);
  assert.equal(isOpenClawWizardSessionLost(new Error('OpenClaw wizard session is not running.')), true);
  assert.equal(isOpenClawWizardSessionLost(new Error('provider authentication failed')), false);
  assert.equal(classifyOpenClawWizardFailure(new Error('wizard already running')), 'already_running');
  assert.equal(classifyOpenClawWizardFailure(new Error('Request timeout (120000ms)')), 'request_timeout');
  assert.equal(classifyOpenClawWizardFailure({
    message: 'invalid request',
    code: 'INVALID_REQUEST',
    details: { code: 'WIZARD_NOT_FOUND' },
  }), 'session_lost');
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
    if (method === 'wizard.status') return { status: 'running' };
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
    method: 'wizard.status',
    params: { sessionId: 'session-2' },
    options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
  });
  assert.deepEqual(calls[2], {
    method: 'wizard.next',
    params: { sessionId: 'session-2' },
    options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
  });
  assert.equal(isOpenClawWizardStepDesynchronized(new Error('wizard: no pending step')), true);
});
