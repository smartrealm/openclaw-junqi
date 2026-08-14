import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayReadyPrimaryActionKind,
  isOpenClawUpdateContinuationDisabled,
  shouldVisitOpenClawUpdateStep,
  wizardFailureDestination,
} from './setupPreflight';

test('只有本次设置前已经存在的 Native OpenClaw 进入独立更新步骤', () => {
  assert.equal(shouldVisitOpenClawUpdateStep('native', 'existing'), true);
  assert.equal(shouldVisitOpenClawUpdateStep('native', 'user'), false);
  assert.equal(shouldVisitOpenClawUpdateStep('native', 'custom'), false);
  assert.equal(shouldVisitOpenClawUpdateStep('docker', 'existing'), false);
});

test('运行时配置完成后的主操作按已有安装与本次新安装区分文案', () => {
  assert.equal(gatewayReadyPrimaryActionKind('native', 'existing'), 'next');
  assert.equal(gatewayReadyPrimaryActionKind('native', 'user'), 'verify-configuration');
  assert.equal(gatewayReadyPrimaryActionKind('native', 'custom'), 'verify-configuration');
  assert.equal(gatewayReadyPrimaryActionKind('docker', 'existing'), 'verify-configuration');
});

test('独立更新步骤在检查完成前不能进入官方配置', () => {
  for (const checkState of ['pending', 'error'] as const) {
    assert.equal(isOpenClawUpdateContinuationDisabled({
      checkResult: { state: checkState, available: null, managedChannelPolicy: null },
    }), true);
  }

  assert.equal(isOpenClawUpdateContinuationDisabled({
    checkResult: { state: 'ready', available: false, managedChannelPolicy: 'eligible' },
  }), false);
});

test('Classic Wizard 参数不兼容始终留在配置页而不进入更新页', () => {
  assert.equal(wizardFailureDestination(false, 'protocol-incompatible'), 'configure-openclaw');
  assert.equal(wizardFailureDestination(true, 'wizard'), 'configure-openclaw');
  assert.equal(wizardFailureDestination(false, 'wizard'), null);
});

test('beta、dev 与未知渠道都不能进入受管配置或更新', () => {
  for (const managedChannelPolicy of ['unsupported', 'unknown'] as const) {
    const checkResult = { state: 'ready' as const, available: true, managedChannelPolicy };
    assert.equal(isOpenClawUpdateContinuationDisabled({
      checkResult,
    }), true);
  }
});
