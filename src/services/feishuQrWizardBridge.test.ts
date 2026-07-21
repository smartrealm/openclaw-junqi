import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawWizardResult, OpenClawWizardStep } from './openclawWizard';
import {
  FeishuQrWizardBridge,
  FeishuQrWizardSessionChangedError,
  isFeishuQrSetupMethodStep,
} from './feishuQrWizardBridge';
import type { ChannelEnrollmentCompletion } from './channelEnrollment';

test('detects the official Feishu QR capability without depending on display copy', () => {
  assert.equal(isFeishuQrSetupMethodStep({
    id: 'runtime-generated-id',
    type: 'select',
    options: [
      { value: 'manual', label: '手动输入凭据' },
      { value: 'scan', label: '扫描二维码' },
    ],
  }), true);
});

test('leaves changed or unknown Gateway choices to the generic wizard renderer', () => {
  assert.equal(isFeishuQrSetupMethodStep({
    id: 'runtime-generated-id',
    type: 'select',
    options: [
      { value: 'manual', label: 'Manual' },
      { value: 'device-code', label: 'Device code' },
    ],
  }), false);
});

const COMPLETION: ChannelEnrollmentCompletion = {
  sessionId: 'session-protocol',
  channel: 'feishu',
  domain: 'feishu',
};

const SETUP_METHOD_STEP: OpenClawWizardStep = {
  id: 'feishu.setupMethod',
  type: 'select',
  options: [
    { value: 'manual', label: 'manual' },
    { value: 'scan', label: 'scan' },
  ],
};

const DOMAIN_STEP: OpenClawWizardStep = {
  id: 'feishu.domain',
  type: 'select',
  options: [
    { value: 'feishu', label: 'feishu' },
    { value: 'lark', label: 'lark' },
  ],
};

const APP_ID_STEP: OpenClawWizardStep = {
  id: 'feishu.appId',
  type: 'text',
  sensitive: false,
};

const SECRET_MODE_STEP: OpenClawWizardStep = {
  id: 'feishu.secretMode',
  type: 'select',
  options: [
    { value: 'plaintext', label: 'plaintext' },
    { value: 'ref', label: 'ref' },
  ],
};

const APP_SECRET_STEP: OpenClawWizardStep = {
  id: 'feishu.appSecret',
  type: 'text',
  sensitive: true,
};

// Pre-loads readChannelEnrollmentCredential so the bridge can fetch credentials
// without touching the backend in this test environment.
type Reader = (credential: 'appId' | 'appSecret') => Promise<string>;

function mockReader(returnValue = 'fetched-credential'): Reader {
  return async (credential) => `${returnValue}-${credential}`;
}

test('rejects protocol drift: App Secret before App ID is treated as session change', async () => {
  // 逆序:先拿到 sensitive text 后才有非 sensitive text — 这违反既定的
  // App ID → secret mode → App Secret 顺序,应立刻抛协议漂移异常。
  const calls: string[] = [];
  const submit = async (stepId: string): Promise<OpenClawWizardResult> => {
    calls.push(stepId);
    if (stepId === 'feishu.setupMethod') {
      return { done: false, status: 'running', step: DOMAIN_STEP };
    }
    if (stepId === 'feishu.domain') {
      return { done: false, status: 'running', step: APP_SECRET_STEP };
    }
    throw new Error(`unexpected stepId=${stepId}`);
  };

  const bridge = new FeishuQrWizardBridge(COMPLETION);
  await assert.rejects(
    () => bridge.complete(SETUP_METHOD_STEP, submit),
    (error: unknown) => error instanceof FeishuQrWizardSessionChangedError
      && /App Secret step before collecting the App ID/.test(String(error)),
  );
  // Bridge should report the failure without ever replaying credentials.
  assert.deepEqual(calls, ['feishu.setupMethod', 'feishu.domain']);
});

test('rejects protocol drift: secret mode returned before App ID', async () => {
  const calls: string[] = [];
  const submit = async (stepId: string): Promise<OpenClawWizardResult> => {
    calls.push(stepId);
    if (stepId === 'feishu.setupMethod') {
      return { done: false, status: 'running', step: DOMAIN_STEP };
    }
    if (stepId === 'feishu.domain') {
      return { done: false, status: 'running', step: SECRET_MODE_STEP };
    }
    throw new Error(`unexpected stepId=${stepId}`);
  };

  const bridge = new FeishuQrWizardBridge(COMPLETION);
  await assert.rejects(
    () => bridge.complete(SETUP_METHOD_STEP, submit),
    (error: unknown) => error instanceof FeishuQrWizardSessionChangedError
      && /secret storage mode before the App ID/.test(String(error)),
  );
  assert.deepEqual(calls, ['feishu.setupMethod', 'feishu.domain']);
});
