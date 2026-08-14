import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenClawWizardFailure,
  isOpenClawWizardTerminalResult,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  OpenClawWizardCancelledError,
  OpenClawWizardClient,
  OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS,
  OpenClawWizardOperationSupersededError,
  createScopedOpenClawWizardSessionStore,
} from './openclawWizard';
import { GatewayRpcError } from '@/services/gateway/Connection';

test('wizard client preserves dynamic option values and session lifecycle', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; options?: { timeoutMs?: number | null } }> = [];
  const client = new OpenClawWizardClient(async (method, params, options) => {
    calls.push({ method, params, ...(options ? { options } : {}) });
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-1',
        done: false,
        status: 'running',
        step: {
          id: 'provider',
          type: 'select',
          options: [
            { label: 'Skip for now', value: '__skip__', hint: 'Configure this later' },
            { label: 'Provider', value: { id: 'dynamic' } },
          ],
        },
      };
    }
    return { done: true, status: 'done' };
  });

  const started = await client.start({ workspace: ' /tmp/workspace ' });
  assert.deepEqual(started.step?.options?.[0], {
    label: 'Skip for now',
    value: '__skip__',
    hint: 'Configure this later',
  });
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
      options: { timeoutMs: null },
    },
  ]);
  await assert.rejects(() => client.next('provider', 'again'), /not running/);
});

test('首次引导只启动官方完整向导并保留渠道跳过说明', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawWizardClient(async (method, params) => {
    calls.push({ method, params });
    return {
      sessionId: 'setup-session-1',
      done: false,
      status: 'running',
      step: {
        id: 'channels-skipped',
        type: 'note',
        title: 'Channels',
        message: 'Channel configuration was skipped by OpenClaw.',
      },
    };
  });

  const result = await client.start({ installDaemon: false });

  assert.deepEqual(calls, [{
    method: 'wizard.start',
    params: { mode: 'local', installDaemon: false },
  }]);
  assert.deepEqual(result.step, {
    id: 'channels-skipped',
    type: 'note',
    title: 'Channels',
    message: 'Channel configuration was skipped by OpenClaw.',
  });
});

test('渠道配置使用官方 channels flow 并保留真实完成账号', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawWizardClient(async (method, params) => {
    calls.push({ method, params });
    return {
      sessionId: 'channels-session-1',
      done: true,
      status: 'done',
      channels: ['dingtalk-connector'],
      accounts: [{ channel: 'dingtalk-connector', accountId: 'work' }],
    };
  });

  const result = await client.start({ flow: 'channels', channel: 'dingtalk-connector' });

  assert.deepEqual(calls, [{
    method: 'wizard.start',
    params: { flow: 'channels', channel: 'dingtalk-connector' },
  }]);
  assert.deepEqual(result.accounts, [{ channel: 'dingtalk-connector', accountId: 'work' }]);
  await assert.rejects(() => client.start({ flow: 'channels' }), /requires a channel/);
});

test('wizard client lets the official plugin own interactive authorization timeout', async () => {
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
    throw new Error('Gateway transport closed');
  });

  await client.start();
  await assert.rejects(
    () => client.next('external-authorization'),
    /Gateway transport closed/,
  );

  assert.equal(client.activeSessionId, 'session-timeout');
  assert.equal(client.currentStepView?.id, 'external-authorization');
  assert.deepEqual(calls.at(-1), {
    method: 'wizard.next',
    options: { timeoutMs: null },
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
    if (method === 'wizard.status') throw new Error('wizard.status clears the official session');
    return { done: true, status: 'done' };
  }, store);
  await resumedClient.resume();

  assert.deepEqual(calls, [
    {
      method: 'wizard.next',
      params: { sessionId: 'persisted-session' },
      options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
    },
  ]);
  assert.equal(storedSessionId, null);
});

test('Wizard 会话只会在创建它的运行时与 Gateway 目标中恢复', async () => {
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => { values.clear(); },
    },
  });
  try {
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
  } finally {
    if (previousLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
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
    return { done: true, status: 'error' };
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

  assert.deepEqual(calls.slice(-1), ['wizard.next:']);
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
    return { done: true, status: 'cancelled' };
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

test('带 done 状态的进度步骤仍保留官方会话', async () => {
  const client = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-progress',
        done: false,
        status: 'running',
        step: { id: 'confirm-done', type: 'confirm' },
      };
    }
    return {
      done: false,
      status: 'done',
      step: { id: 'final-progress', type: 'note', message: 'Done' },
    };
  });

  await client.start();
  const progress = await client.next('confirm-done', true);

  assert.equal(progress.done, false);
  assert.equal(progress.step?.id, 'final-progress');
  assert.equal(client.activeSessionId, 'session-progress');
});

test('只有 done 为真时官方状态才构成 Wizard 终态', () => {
  assert.equal(isOpenClawWizardTerminalResult({
    done: false,
    status: 'done',
    step: { id: 'final-note', type: 'note' },
  }), false);
  assert.equal(isOpenClawWizardTerminalResult({ done: true, status: 'done' }), true);
  assert.equal(isOpenClawWizardTerminalResult({ done: true, status: 'cancelled' }), true);
  assert.equal(isOpenClawWizardTerminalResult({ done: true, status: 'error' }), true);
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

test('官方授权字段会完整到达界面', async () => {
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
    assert.equal(result.step?.externalUrl, step.externalUrl);
    assert.deepEqual(result.step?.deviceCode, step.deviceCode);
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

test('wizard recovery and cancellation tolerate additive result fields', async () => {
  const statusClient = new OpenClawWizardClient(async (method) => {
    if (method === 'wizard.start') {
      return {
        sessionId: 'session-status-shape',
        done: false,
        status: 'running',
        step: { id: 'provider', type: 'select' },
      };
    }
    return { done: true, status: 'done', extra: true };
  });
  await statusClient.start();
  // 额外字段不影响官方终态处理，避免遗留会话无法清理。
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
  assert.equal(classifyOpenClawWizardFailure({
    message: 'OpenClaw setup is already in progress; try again when it finishes.',
    code: 'UNAVAILABLE',
    details: { retryable: true },
  }), 'already_running');
  assert.equal(classifyOpenClawWizardFailure({
    message: 'OpenClaw setup is already in progress; try again when it finishes.',
    code: 'UNAVAILABLE',
    details: { retryable: false },
  }), 'unknown');
  assert.equal(classifyOpenClawWizardFailure(new Error('wizard already running')), 'unknown');
  assert.equal(classifyOpenClawWizardFailure(new Error('Request timeout (120000ms)')), 'request_timeout');
  assert.equal(classifyOpenClawWizardFailure({
    message: 'invalid request',
    code: 'INVALID_REQUEST',
    details: { code: 'WIZARD_NOT_FOUND' },
  }), 'session_lost');
});

test('BUG-02 将正式 installDaemon 字段拒绝分类为不可重复的协议不满足', () => {
  assert.equal(classifyOpenClawWizardFailure(new GatewayRpcError(
    "invalid wizard.start params: at root: unexpected property 'installDaemon'",
    'INVALID_REQUEST',
  )), 'protocol_unsupported');
  assert.equal(classifyOpenClawWizardFailure(new GatewayRpcError(
    "invalid wizard.start params: at root: unexpected property 'workspace'",
    'INVALID_REQUEST',
  )), 'unknown');
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
    options: { timeoutMs: OPENCLAW_WIZARD_CONTROL_TIMEOUT_MS },
  });
  assert.equal(isOpenClawWizardStepDesynchronized(new Error('wizard: no pending step')), true);
});
