import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawProgressCardResponseError,
  currentOpenClawProgressCardStepIndex,
  parseOpenClawProgressCardResult,
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
