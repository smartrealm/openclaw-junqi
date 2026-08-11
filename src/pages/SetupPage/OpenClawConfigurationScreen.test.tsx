import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SetupFlow } from '@/hooks/useSetupFlow';
import { OpenClawConfigurationScreen } from './OpenClawConfigurationScreen';
import { WizardScreen } from './WizardScreen';
import { resolveWizardAuthorizationUrl } from './wizard/WizardAuthorizationHint';

type VerificationFlow = Pick<
  SetupFlow,
  | 'presentation'
  | 'gatewayReadyContinuation'
  | 'goBack'
  | 'continueAfterGatewayReady'
>;

function createVerificationFlow(
  gatewayReadyContinuation: SetupFlow['gatewayReadyContinuation'],
): VerificationFlow {
  return {
    presentation: { state: 'gateway-ready', stage: 3, kind: 'gateway-ready' },
    gatewayReadyContinuation,
    goBack: async () => undefined,
    continueAfterGatewayReady: async () => undefined,
  };
}

function renderVerificationState(
  gatewayReadyContinuation: SetupFlow['gatewayReadyContinuation'],
): string {
  return renderToStaticMarkup(
    <OpenClawConfigurationScreen
      flow={createVerificationFlow(gatewayReadyContinuation)}
      logs={[]}
      phase="verification"
    />,
  );
}

test('Gateway 就绪在配置阶段显示显式核验操作', () => {
  const html = renderVerificationState({ status: 'idle', error: null });

  assert.match(html, /Configure OpenClaw/);
  assert.match(html, /Gateway is ready/);
  assert.match(html, /Verify configuration/);
  assert.match(html, /Debug Log/);
  assert.match(html, /No installation or startup action has run yet/);
  assert.doesNotMatch(html, /Verifying configuration/);
});

test('等待官方向导步骤时仍默认展开日志', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const wizard = {
    wizardStep: null,
    wizardSubmitting: false,
    wizardActivity: null,
    wizardError: null,
    wizardRecoveryMode: null,
    submitWizardStep: async () => null,
    pollWizard: async () => null,
    retryWizard: async () => null,
    reclaimWizard: async () => null,
  };

  const html = renderToStaticMarkup(
    <WizardScreen flow={flow} logs={[]} wizard={wizard} />,
  );

  assert.match(html, /Debug Log/);
  assert.match(html, /No installation or startup action has run yet/);
});

test('任意官方向导步骤携带授权地址时都呈现二维码入口', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const wizard = {
    wizardStep: {
      id: 'channel-authorization',
      type: 'confirm' as const,
      title: 'Authorize channel',
      message: 'Continue with provider authorization?',
      externalUrl: 'https://provider.example/authorize',
      executor: 'client' as const,
    },
    wizardSubmitting: false,
    wizardActivity: null,
    wizardError: null,
    wizardRecoveryMode: null,
    submitWizardStep: async () => null,
    pollWizard: async () => null,
    retryWizard: async () => null,
    reclaimWizard: async () => null,
  };

  const html = renderToStaticMarkup(
    <WizardScreen flow={flow} logs={[]} wizard={wizard} />,
  );

  assert.match(html, /data-wizard-authorization="true"/);
  assert.match(html, /data-wizard-authorization-qr="true"/);
  assert.match(html, /data-qr-display="loading"/);
  assert.match(html, /Open in browser/);
});

test('官方提示文本只含一个 HTTPS 地址时呈现该地址的二维码入口', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const wizard = {
    wizardStep: {
      id: 'channel-authorization-note',
      type: 'note' as const,
      title: 'DingTalk authorization',
      message: [
        'QR rendering failed in current terminal.',
        'Authorization URL: https://provider.example/authorize?code=test',
        'Continue with URL authorization.',
      ].join('\n'),
      executor: 'client' as const,
    },
    wizardSubmitting: false,
    wizardActivity: null,
    wizardError: null,
    wizardRecoveryMode: null,
    submitWizardStep: async () => null,
    pollWizard: async () => null,
    retryWizard: async () => null,
    reclaimWizard: async () => null,
  };

  const html = renderToStaticMarkup(
    <WizardScreen flow={flow} logs={[]} wizard={wizard} />,
  );

  assert.match(html, /data-wizard-authorization="true"/);
  assert.match(html, /data-wizard-authorization-qr="true"/);
  assert.match(html, /data-qr-display="loading"/);
});

test('授权地址投影只接受结构化地址或正文中的唯一 HTTPS 地址', () => {
  assert.equal(resolveWizardAuthorizationUrl({
    externalUrl: 'https://provider.example/structured',
    message: 'Authorization URL: https://provider.example/note',
  }), 'https://provider.example/structured');
  assert.equal(resolveWizardAuthorizationUrl({
    message: [
      'QR rendering failed in current terminal.',
      'Authorization URL: https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=test&source=DING_DWS_CLAW',
      'You can continue with URL authorization.',
    ].join('\n'),
  }), 'https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=test&source=DING_DWS_CLAW');
  assert.equal(resolveWizardAuthorizationUrl({
    message: 'Choose https://provider.example/one or https://provider.example/two',
  }), undefined);
  assert.equal(resolveWizardAuthorizationUrl({ message: 'No authorization URL' }), undefined);
});

test('正常交互步骤默认收起日志并保留手动展开入口', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const wizard = {
    wizardStep: {
      id: 'channel-authorization',
      type: 'note' as const,
      title: 'Authorize channel',
      message: 'Continue with provider authorization?',
      executor: 'client' as const,
    },
    wizardSubmitting: false,
    wizardActivity: null,
    wizardError: null,
    wizardRecoveryMode: null,
    submitWizardStep: async () => null,
    pollWizard: async () => null,
    retryWizard: async () => null,
    reclaimWizard: async () => null,
  };

  const html = renderToStaticMarkup(
    <WizardScreen
      flow={flow}
      logs={[{ source: 'gateway', message: '运行时日志', ts: 0, level: 'info' }]}
      wizard={wizard}
    />,
  );

  assert.match(html, /View logs/);
  assert.doesNotMatch(html, /运行时日志/);
});

test('模型供应商或渠道长列表提供通用搜索且保留官方选项', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const options = Array.from({ length: 8 }, (_, index) => ({
    value: `provider-${index}`,
    label: `Provider ${index}`,
    hint: `Official option ${index}`,
  }));
  const html = renderToStaticMarkup(
    <WizardScreen
      flow={flow}
      logs={[]}
      wizard={{
        wizardStep: {
          id: 'model-provider',
          type: 'select',
          message: 'Model/auth provider',
          options,
        },
        wizardSubmitting: false,
        wizardActivity: null,
        wizardError: null,
        wizardRecoveryMode: null,
        submitWizardStep: async () => null,
        pollWizard: async () => null,
        retryWizard: async () => null,
        reclaimWizard: async () => null,
      }}
    />,
  );

  assert.match(html, /type="search"/);
  assert.match(html, /Search options/);
  assert.match(html, /Provider 0/);
  assert.match(html, /Provider 7/);
});

test('交互步骤失败时自动展开日志', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const wizard = {
    wizardStep: {
      id: 'channel-authorization',
      type: 'note' as const,
      title: 'Authorize channel',
      message: 'Continue with provider authorization?',
      executor: 'client' as const,
    },
    wizardSubmitting: false,
    wizardActivity: null,
    wizardError: '授权步骤失败',
    wizardRecoveryMode: null,
    submitWizardStep: async () => null,
    pollWizard: async () => null,
    retryWizard: async () => null,
    reclaimWizard: async () => null,
  };

  const html = renderToStaticMarkup(
    <WizardScreen
      flow={flow}
      logs={[{ source: 'gateway', message: '运行时日志', ts: 0, level: 'error' }]}
      wizard={wizard}
    />,
  );

  assert.match(html, /Hide logs/);
  assert.match(html, /运行时日志/);
});

test('配置核验中的同一容器锁定重复操作', () => {
  const html = renderVerificationState({ status: 'checking', error: null });

  assert.match(html, /Verifying OpenClaw configuration/);
  assert.match(html, /Verifying configuration/);
  assert.match(html, /disabled=""/);
});

test('授权步骤提交后用等待状态替换旧二维码', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const html = renderToStaticMarkup(
    <WizardScreen
      flow={flow}
      logs={[]}
      wizard={{
        wizardStep: {
          id: 'dingtalk-authorization',
          type: 'note',
          title: 'DingTalk authorization',
          message: 'Authorization URL: https://provider.example/authorize',
          executor: 'client',
        },
        wizardSubmitting: true,
        wizardActivity: null,
        wizardError: null,
        wizardRecoveryMode: null,
        submitWizardStep: async () => null,
        pollWizard: async () => null,
        retryWizard: async () => null,
        reclaimWizard: async () => null,
      }}
    />,
  );

  assert.match(html, /Waiting for authorization/);
  assert.match(html, /Pause and return/);
  assert.doesNotMatch(html, /data-wizard-authorization-qr/);
  assert.doesNotMatch(html, /Open in browser/);
});

test('官方终态后的失败提供 Gateway 核验操作', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const html = renderToStaticMarkup(
    <WizardScreen
      flow={flow}
      logs={[]}
      wizard={{
        wizardStep: null,
        wizardSubmitting: false,
        wizardActivity: null,
        wizardError: 'Gateway connection failed',
        wizardRecoveryMode: 'runtime',
        submitWizardStep: async () => null,
        pollWizard: async () => null,
        retryWizard: async () => null,
        reclaimWizard: async () => null,
      }}
    />,
  );

  assert.match(html, /Verify again/);
  assert.doesNotMatch(html, /Take over setup/);
});

test('配置核验失败在同一容器呈现真实错误与重试操作', () => {
  const html = renderVerificationState({ status: 'failed', error: '模型凭据未验证' });

  assert.match(html, /Configuration verification incomplete/);
  assert.match(html, /模型凭据未验证/);
  assert.match(html, /Verify again/);
});
