import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SetupFlow } from '@/hooks/useSetupFlow';
import { OpenClawConfigurationScreen } from './OpenClawConfigurationScreen';
import { wizardPrimaryActionDisabled, WizardRestartConfirmation, WizardScreen } from './WizardScreen';
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

function createGuidedFlow(): SetupFlow {
  return {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'official-wizard' },
    configurationMode: 'guided',
    guidedSetup: {
      phase: 'selecting',
      detection: {
        candidates: [{
          kind: 'codex-cli',
          brandId: 'test-provider',
          label: 'Codex CLI',
          detail: 'Detected by OpenClaw',
          modelRef: 'openai/codex',
          recommended: true,
        }],
        manualProviders: [],
        workspace: '/workspace',
        setupComplete: false,
      },
      activation: null,
      chat: null,
      wizardStep: null,
      busy: false,
      error: null,
      activateCandidate: async () => undefined,
      activateManual: async () => undefined,
      startProviderAuth: async () => undefined,
      startProviderPrepare: async () => undefined,
      submitProviderWizard: async () => undefined,
      submitChat: async () => undefined,
      finishChat: async () => undefined,
      retry: async () => undefined,
    },
    goBack: async () => undefined,
    openClassicSetup: () => undefined,
  } as unknown as SetupFlow;
}

function createGuidedAuthorizationFlow(busy: boolean): SetupFlow {
  const flow = createGuidedFlow();
  return {
    ...flow,
    guidedSetup: {
      ...flow.guidedSetup,
      phase: 'provider-wizard',
      busy,
      wizardStep: {
        id: 'provider-auth',
        type: 'confirm',
        title: 'Authorize provider',
        message: 'Continue with provider authorization?',
        externalUrl: 'https://provider.example/authorize?user_code=ABCD',
      },
    },
  };
}

test('首次配置默认呈现 OpenClaw Guided 探测结果，Classic 仅作为显式入口', () => {
  const html = renderToStaticMarkup(
    <OpenClawConfigurationScreen flow={createGuidedFlow()} logs={[]} phase="wizard" />,
  );

  assert.match(html, /Detected options/);
  assert.match(html, /Codex CLI/);
  assert.match(html, /Recommended/);
  assert.match(html, /Detailed setup/);
  assert.doesNotMatch(html, /Waiting for the next official step/);
});

test('用户显式选择 Classic 后才呈现官方详细向导', () => {
  const flow = {
    ...createGuidedFlow(),
    configurationMode: 'classic' as const,
    wizardStep: null,
    wizardSubmitting: false,
    wizardActivity: null,
    wizardError: null,
    wizardRecoveryMode: null,
    submitWizardStep: async () => null,
    pollWizard: async () => null,
    retryWizard: async () => null,
    reclaimWizard: async () => null,
  } as unknown as SetupFlow;
  const html = renderToStaticMarkup(
    <OpenClawConfigurationScreen flow={flow} logs={[]} phase="wizard" />,
  );

  assert.match(html, /Connecting to the official OpenClaw setup wizard/);
  assert.doesNotMatch(html, /Detected inference options/);
});

test('Guided 供应商授权复用官方步骤二维码呈现', () => {
  const html = renderToStaticMarkup(
    <OpenClawConfigurationScreen
      flow={createGuidedAuthorizationFlow(false)}
      logs={[]}
      phase="wizard"
    />,
  );

  assert.match(html, /data-wizard-authorization="true"/);
  assert.match(html, /data-wizard-authorization-qr="true"/);
  assert.match(html, /Authorization complete, continue/);
});

test('Guided 授权提交后立即销毁旧二维码并等待官方终态', () => {
  const html = renderToStaticMarkup(
    <OpenClawConfigurationScreen
      flow={createGuidedAuthorizationFlow(true)}
      logs={[]}
      phase="wizard"
    />,
  );

  assert.match(html, /Waiting for the provider flow/);
  assert.doesNotMatch(html, /data-wizard-authorization="true"/);
  assert.doesNotMatch(html, /data-wizard-authorization-qr="true"/);
});

test('Gateway 就绪在配置阶段显示显式核验操作', () => {
  const html = renderVerificationState({ status: 'idle', error: null });

  assert.match(html, /Configure OpenClaw/);
  assert.match(html, /Gateway connection and runtime identity verified/);
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
  assert.match(html, /After scanning or completing authorization in your browser/);
  assert.match(html, /Authorization complete, continue/);
  assert.doesNotMatch(html, />Next</);
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
        'Authorization URL: https://provider.example/authorize?user_code=test',
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
  assert.match(html, /Authorization complete, continue/);
});

test('授权地址投影只接受结构化地址或正文中的一次性授权地址', () => {
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
  assert.equal(resolveWizardAuthorizationUrl({
    message: 'Next steps: https://provider.example/documentation',
  }), undefined);
  assert.equal(resolveWizardAuthorizationUrl({ message: 'No authorization URL' }), undefined);
});

test('后续说明步骤不会继承上一授权步骤的二维码', () => {
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
          id: 'channel-configuration-complete',
          type: 'note',
          title: 'Channel configured',
          message: 'Read the next steps at https://provider.example/documentation',
          executor: 'client',
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

  assert.doesNotMatch(html, /data-wizard-authorization/);
  assert.doesNotMatch(html, /data-wizard-authorization-qr/);
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
          message: 'Authorization URL: https://provider.example/authorize?user_code=test',
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

test('普通官方步骤提交时保留官方内容并锁定重复交互', () => {
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
          id: 'quickstart-note',
          type: 'note',
          title: 'QuickStart',
          message: 'Gateway port: 18789',
          executor: 'client',
        },
        wizardSubmitting: true,
        wizardActivity: 'OpenClaw is applying the current answer',
        wizardError: null,
        wizardRecoveryMode: null,
        submitWizardStep: async () => null,
        pollWizard: async () => null,
        retryWizard: async () => null,
        reclaimWizard: async () => null,
      }}
    />,
  );

  assert.match(html, /Gateway port: 18789/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.doesNotMatch(html, /Waiting for the next official step/);
  assert.doesNotMatch(html, /OpenClaw is applying the current answer/);
  assert.match(html, /data-setup-content-layout="stable"/);
});

test('Done 提示提交时保留官方原文但不进入 JunQi 完成页', () => {
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
          id: 'official-outro',
          type: 'note',
          title: 'Done',
          message: 'Run openclaw status for details.',
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

  assert.match(html, /Run openclaw status for details/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /Waiting for the next official step/);
  assert.doesNotMatch(html, /进入仪表盘/);
});

test('官方短提示只呈现一次正文并使用稳定紧凑布局', () => {
  const flow = {
    presentation: { state: 'configure-openclaw', stage: 3, kind: 'wizard' },
    goBack: async () => undefined,
  } as unknown as SetupFlow;
  const message = 'Keep existing Gateway settings';
  const html = renderToStaticMarkup(
    <WizardScreen
      flow={flow}
      logs={[]}
      wizard={{
        wizardStep: {
          id: 'quickstart-note',
          type: 'note',
          title: 'QuickStart',
          message,
          executor: 'client',
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

  assert.equal(html.split(message).length - 1, 1);
  assert.match(html, /data-wizard-content-layout="compact"/);
  assert.doesNotMatch(html, /This content comes from the selected OpenClaw Runtime/);
  assert.doesNotMatch(html, /Complete model, credential, workspace, and Gateway setup/);
});

test('步骤失败时错误状态替换旧步骤内容', () => {
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
          id: 'stale-confirm',
          type: 'confirm',
          title: 'Channel setup',
          message: 'Stale confirmation must be hidden',
          executor: 'client',
        },
        wizardSubmitting: false,
        wizardActivity: null,
        wizardError: 'The official step could not continue',
        wizardRecoveryMode: null,
        submitWizardStep: async () => null,
        pollWizard: async () => null,
        retryWizard: async () => null,
        reclaimWizard: async () => null,
      }}
    />,
  );

  assert.match(html, /OpenClaw setup needs attention/);
  assert.match(html, /The official step could not continue/);
  assert.doesNotMatch(html, /Stale confirmation must be hidden/);
});

test('错误恢复不会被旧提交状态锁住，正常等待仍禁止重复操作', () => {
  assert.equal(wizardPrimaryActionDisabled({
    submitting: true,
    error: 'Official step failed',
  }), false);
  assert.equal(wizardPrimaryActionDisabled({
    submitting: true,
    error: null,
  }), true);
  assert.equal(wizardPrimaryActionDisabled({
    submitting: false,
    error: null,
    automatic: true,
  }), true);
  assert.equal(wizardPrimaryActionDisabled({
    submitting: false,
    error: null,
    canRecover: false,
  }), true);
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

test('终态未知时只提供知情后的显式重启向导操作', () => {
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
        wizardError: 'The original setup session ended before OpenClaw returned its final result',
        wizardRecoveryMode: 'terminal-unknown',
        submitWizardStep: async () => null,
        pollWizard: async () => null,
        retryWizard: async () => null,
        reclaimWizard: async () => null,
      }}
    />,
  );

  assert.match(html, /Restart official wizard/);
  assert.doesNotMatch(html, />Retry</);
});

test('重新开始官方向导前展示重复写入风险和取消操作', () => {
  const html = renderToStaticMarkup(
    <WizardRestartConfirmation
      open
      onClose={() => undefined}
      onConfirm={() => undefined}
    />,
  );

  assert.match(html, /Restart the official wizard/);
  assert.match(html, /may repeat configuration writes/);
  assert.match(html, /Confirm and restart/);
  assert.match(html, />Cancel</);
  assert.match(html, /role="alertdialog"/);
});

test('配置核验失败在同一容器呈现真实错误与重试操作', () => {
  const html = renderVerificationState({ status: 'failed', error: '模型凭据未验证' });

  assert.match(html, /Configuration verification incomplete/);
  assert.match(html, /模型凭据未验证/);
  assert.match(html, /Verify again/);
});
