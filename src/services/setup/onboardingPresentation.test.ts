import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnboardingPresentationMachine } from './onboardingPresentation';

test('引导呈现状态将可取消的 Gateway 启动归入运行时执行阶段', () => {
  const machine = createOnboardingPresentationMachine('storage');
  assert.deepEqual(machine.transition('gateway-stopped'), {
    state: 'gateway-stopped',
    stage: 2,
    kind: 'operation',
  });
});

test('引导呈现状态区分官方配置、失败和已验证完成', () => {
  const machine = createOnboardingPresentationMachine('configure-openclaw');
  assert.deepEqual(machine.snapshot, {
    state: 'configure-openclaw',
    stage: 3,
    kind: 'official-wizard',
  });
  assert.deepEqual(machine.transition('error'), {
    state: 'error',
    stage: 2,
    kind: 'failure',
  });
  assert.deepEqual(machine.transition('ready'), {
    state: 'ready',
    stage: 5,
    kind: 'complete',
  });
});

test('引导呈现状态机为每个持久化页面状态提供确定的用户语义', () => {
  const machine = createOnboardingPresentationMachine('welcome');
  const expectations = [
    ['welcome', -1, 'decision'],
    ['detecting', 0, 'operation'],
    ['environment-review', 0, 'decision'],
    ['storage', 1, 'decision'],
    ['choosing-mode', 2, 'decision'],
    ['gateway-stopped', 2, 'operation'],
    ['checking', 2, 'operation'],
    ['install-git', 2, 'operation'],
    ['git-missing', 2, 'decision'],
    ['node-missing', 2, 'decision'],
    ['install-node', 2, 'operation'],
    ['install-openclaw', 2, 'operation'],
    ['gateway-ready', 2, 'gateway-ready'],
    ['configure-openclaw', 3, 'official-wizard'],
    ['configure-channels', 4, 'official-wizard'],
    ['error', 2, 'failure'],
    ['ready', 5, 'complete'],
  ] as const;

  for (const [state, stage, kind] of expectations) {
    assert.deepEqual(machine.transition(state), { state, stage, kind });
  }
});
