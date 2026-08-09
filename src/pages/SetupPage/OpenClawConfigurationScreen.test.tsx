import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SetupFlow } from '@/hooks/useSetupFlow';
import { OpenClawConfigurationScreen } from './OpenClawConfigurationScreen';

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
  assert.doesNotMatch(html, /Verifying configuration/);
});

test('配置核验中的同一容器锁定重复操作', () => {
  const html = renderVerificationState({ status: 'checking', error: null });

  assert.match(html, /Verifying OpenClaw configuration/);
  assert.match(html, /Verifying configuration/);
  assert.match(html, /disabled=""/);
});

test('配置核验失败在同一容器呈现真实错误与重试操作', () => {
  const html = renderVerificationState({ status: 'failed', error: '模型凭据未验证' });

  assert.match(html, /Configuration verification incomplete/);
  assert.match(html, /模型凭据未验证/);
  assert.match(html, /Verify again/);
});
