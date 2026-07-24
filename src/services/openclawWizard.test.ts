import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenClawWizardFailure,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  OpenClawWizardCancelledError,
  OpenClawWizardCancellationLockedError,
  OpenClawWizardClient,
  OpenClawWizardOperationSupersededError,
  requiresOpenClawOnboarding,
} from './openclawWizard';

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
    { method: 'wizard.start', params: { mode: 'local', workspace: '/tmp/workspace' } },
    {
      method: 'wizard.next',
      params: { sessionId: 'session-1', answer: { stepId: 'provider', value: { id: 'dynamic' } } },
      options: { timeoutMs: null },
    },
  ]);
  await assert.rejects(() => client.next('provider', 'again'), /not running/);
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

  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const resumedClient = new OpenClawWizardClient(async (method, params) => {
    calls.push({ method, params });
    return { done: true, status: 'done' };
  }, store);
  await resumedClient.resume();

  assert.deepEqual(calls, [{ method: 'wizard.next', params: { sessionId: 'persisted-session' } }]);
  assert.equal(storedSessionId, null);
});

test('wizard client recreates a session to provide a previous-step action', async () => {
  let starts = 0;
  const calls: string[] = [];
  const client = new OpenClawWizardClient(async (method, params) => {
    calls.push(`${method}:${String((params.answer as any)?.stepId ?? '')}`);
    if (method === 'wizard.start') {
      starts += 1;
      return {
        sessionId: `session-${starts}`,
        done: false,
        status: 'running',
        step: { id: 'first', type: 'select', options: [{ value: 'yes', label: 'Yes' }] },
      };
    }
    if ((params.answer as any)?.stepId === 'first') {
      return {
        done: false,
        status: 'running',
        step: { id: 'second', type: 'select', options: [{ value: 'next', label: 'Next' }] },
      };
    }
    if (method === 'wizard.cancel') return { status: 'cancelled' };
    throw new Error(`unexpected ${method}`);
  });

  await client.start();
  await client.next('first', 'yes');
  assert.equal(client.canGoBack, true);
  const previous = await client.back();
  assert.equal(previous?.step?.id, 'first');
  assert.deepEqual(calls, [
    'wizard.start:',
    'wizard.next:first',
    'wizard.cancel:',
    'wizard.start:',
  ]);
});

test('wizard client restores a failed step for retry and preserves a previous-step action', async () => {
  let starts = 0;
  const client = new OpenClawWizardClient(async (method, params) => {
    if (method === 'wizard.cancel') return { done: true, status: 'cancelled' };
    if (method === 'wizard.start') {
      starts += 1;
      return { sessionId: `session-${starts}`, done: false, status: 'running', step: { id: 'first', type: 'select' } };
    }
    const stepId = (params.answer as { stepId?: string } | undefined)?.stepId;
    if (stepId === 'first') {
      return { done: false, status: 'running', step: { id: 'second', type: 'select' } };
    }
    if (stepId === 'second' && starts === 1) {
      return { done: false, status: 'error', error: 'gateway choice rejected' };
    }
    throw new Error(`unexpected ${method}:${stepId ?? ''}`);
  });

  await client.start();
  await client.next('first', 'keep');
  const failed = await client.next('second', 'channels');
  assert.equal(failed.status, 'error');
  assert.equal(client.failedStepView?.id, 'second');
  assert.equal(client.diagnosticSessionId, 'session-1');
  assert.equal(client.canGoBack, true);

  const retried = await client.retry();
  assert.equal(retried.step?.id, 'second');
  assert.equal(client.canGoBack, true);
  const previous = await client.back();
  assert.equal(previous?.step?.id, 'first');
});

test('wizard client preserves resume context when the official session terminates with an error', async () => {
  let calls = 0;
  const client = new OpenClawWizardClient(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        sessionId: 'windows-session',
        done: false,
        status: 'running',
        step: { id: 'provider-auth', type: 'action' },
      };
    }
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

  const previous = await client.back();
  assert.equal(previous?.step?.id, 'first');
  assert.deepEqual(calls.slice(-3), [
    'wizard.next:',
    'wizard.cancel:',
    'wizard.start:',
  ]);
});

test('wizard client retains the official session when cancellation is locked by a durable write', async () => {
  let starts = 0;
  const calls: string[] = [];
  const client = new OpenClawWizardClient(async (method, params) => {
    calls.push(`${method}:${String(params.sessionId ?? '')}`);
    if (method === 'wizard.start') {
      starts += 1;
      return {
        sessionId: `session-${starts}`,
        done: false,
        status: 'running',
        step: { id: 'persistent-effect', type: 'progress' },
      };
    }
    if (method === 'wizard.cancel') return { status: 'running' };
    if (method === 'wizard.next') {
      return { done: false, status: 'running', step: { id: 'persistent-effect', type: 'progress' } };
    }
    throw new Error(`unexpected ${method}`);
  });

  await client.start();
  await assert.rejects(() => client.cancel(), OpenClawWizardCancellationLockedError);
  assert.equal(client.activeSessionId, 'session-1');

  // start/back must not forget the locked session or create a competing one.
  await assert.rejects(() => client.start(), OpenClawWizardCancellationLockedError);
  assert.equal(starts, 1);
  assert.equal(client.activeSessionId, 'session-1');

  const resumed = await client.resume();
  assert.equal(resumed.step?.id, 'persistent-effect');
  assert.deepEqual(calls, [
    'wizard.start:',
    'wizard.cancel:session-1',
    'wizard.cancel:session-1',
    'wizard.next:session-1',
  ]);
});

test('wizard client rejects malformed cancellation status without forgetting the session', async () => {
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return { sessionId: 'session-malformed', done: false, status: 'running', step: { id: 'confirm', type: 'confirm' } };
    }
    return { done: true };
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
  assert.equal(classifyOpenClawWizardFailure(new OpenClawWizardCancellationLockedError()), 'cancellation_locked');
  const restarted = await client.retry();
  assert.equal(restarted.sessionId, 'session-2');
});

test('wizard client preserves Gateway option identity and extra metadata', async () => {
  const client = new OpenClawWizardClient(async () => ({
    sessionId: 'session-feishu',
    done: false,
    status: 'running',
    step: {
      id: 'channels',
      type: 'select',
      format: 'plain',
      externalUrl: 'https://auth.example/device',
      deviceCode: { code: 'ABCD-1234', expiresInMinutes: 10, message: 'Enter this code' },
      futureMetadata: { source: 'gateway' },
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
  assert.equal(result.step?.externalUrl, 'https://auth.example/device');
  assert.deepEqual(result.step?.deviceCode, {
    code: 'ABCD-1234',
    expiresInMinutes: 10,
    message: 'Enter this code',
  });
  assert.deepEqual(result.step?.futureMetadata, { source: 'gateway' });
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
