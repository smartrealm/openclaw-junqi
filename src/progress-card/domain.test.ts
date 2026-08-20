import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawProgressCardResponseError,
  currentOpenClawProgressCardStepIndex,
  parseOpenClawLegacyProgressPlanUpdate,
  parseOpenClawProgressCardResult,
  projectOpenClawLegacyProgressCard,
} from './domain';

test('严格投影 OpenClaw 官方持久化进度卡响应', () => {
  const card = parseOpenClawProgressCardResult({
    card: {
      sessionKey: 'agent:main:main',
      revision: 4,
      updatedAt: 1_700_000_000_000,
      markdown: '测试正在运行。',
      steps: [
        { step: '核对协议', status: 'completed' },
        { step: '运行测试', status: 'in_progress' },
        { step: '复核结果', status: 'pending' },
      ],
    },
  });

  assert.ok(card);
  assert.equal(card.revision, 4);
  assert.equal(card.steps[1].status, 'in_progress');
  assert.equal(currentOpenClawProgressCardStepIndex(card), 1);
  assert.equal(parseOpenClawProgressCardResult({ card: null }), null);
});

test('拒绝畸形进度卡和多个运行中步骤', () => {
  assert.throws(() => parseOpenClawProgressCardResult({}), OpenClawProgressCardResponseError);
  assert.throws(() => parseOpenClawProgressCardResult({
    card: {
      sessionKey: 'agent:main:main',
      revision: 1,
      updatedAt: 1,
      steps: [
        { step: '步骤一', status: 'in_progress' },
        { step: '步骤二', status: 'in_progress' },
      ],
    },
  }), OpenClawProgressCardResponseError);
});

test('步骤身份在官方卡片修订之间保持稳定', () => {
  const first = parseOpenClawProgressCardResult({
    card: {
      sessionKey: 'agent:main:main',
      revision: 1,
      updatedAt: 1,
      steps: [{ step: '同一步骤', status: 'pending' }],
    },
  });
  const second = parseOpenClawProgressCardResult({
    card: {
      sessionKey: 'agent:main:main',
      revision: 2,
      updatedAt: 2,
      steps: [{ step: '同一步骤', status: 'completed' }],
    },
  });
  assert.equal(first?.id, second?.id);
  assert.equal(first?.steps[0].id, second?.steps[0].id);
});

test('严格投影已发布 Gateway 的官方计划流', () => {
  const update = parseOpenClawLegacyProgressPlanUpdate({
    sessionKey: ' agent:main:legacy-plan ',
    ts: 1_700_000_000_000,
    data: {
      phase: 'update',
      explanation: ' 正在核对实现。 ',
      steps: [
        { step: '读取协议', status: 'completed' },
        { step: '补充兼容入口', status: 'in_progress' },
        '运行回归测试',
      ],
    },
  });

  assert.ok(update);
  assert.equal(update.sessionKey, 'agent:main:legacy-plan');
  assert.equal(update.markdown, '正在核对实现。');
  assert.deepEqual(update.steps.map((step) => step.status), [
    'completed',
    'in_progress',
    'pending',
  ]);
  const card = projectOpenClawLegacyProgressCard(update, 2);
  assert.ok(card);
  assert.equal(card.revision, 2);
  assert.equal(card.steps.length, 3);
});

test('旧计划流过滤畸形步骤且只保留一个运行中步骤', () => {
  const update = parseOpenClawLegacyProgressPlanUpdate({
    sessionKey: 'agent:main:legacy-plan',
    ts: 1,
    data: {
      phase: 'update',
      steps: [
        { step: '', status: 'pending' },
        { step: '第一项', status: 'in_progress' },
        { step: '第二项', status: 'in_progress' },
        { step: '无效状态', status: 'running' },
      ],
    },
  });

  assert.ok(update);
  assert.deepEqual(update.steps.map((step) => step.step), ['第一项']);
});

test('旧计划流空步骤清除临时投影并拒绝非更新阶段', () => {
  const update = parseOpenClawLegacyProgressPlanUpdate({
    sessionKey: 'agent:main:legacy-plan',
    ts: 1,
    data: { phase: 'update', steps: [] },
  });
  assert.ok(update);
  assert.equal(projectOpenClawLegacyProgressCard(update, 1), null);
  assert.equal(parseOpenClawLegacyProgressPlanUpdate({
    sessionKey: 'agent:main:legacy-plan',
    ts: 1,
    data: { phase: 'start', steps: [] },
  }), null);
  assert.equal(parseOpenClawLegacyProgressPlanUpdate({
    sessionKey: 'agent:main:legacy-plan',
    ts: 1.5,
    data: { phase: 'update', steps: [] },
  }), null);
});
