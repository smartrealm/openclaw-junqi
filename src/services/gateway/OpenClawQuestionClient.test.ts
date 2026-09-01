import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawQuestionClient,
  OpenClawQuestionResponseError,
  type OpenClawQuestionRequester,
} from './OpenClawQuestionClient';

function createClient(
  request: OpenClawQuestionRequester,
): OpenClawQuestionClient {
  return new OpenClawQuestionClient({ request });
}

const pendingQuestion = {
  id: 'question-1',
  questions: [{
    questionId: 'deployment',
    header: '部署方式',
    question: '选择本次部署方式',
    options: [
      { label: 'Native', description: '使用目标机器运行时' },
      { label: 'Docker', description: '使用目标容器运行时' },
    ],
  }],
  agentId: 'main',
  sessionKey: 'agent:main:desktop',
  runId: 'run-1',
  createdAtMs: 100,
  expiresAtMs: 10_000,
  status: 'pending',
} as const;

test('list 只返回官方 pending 问题并保留 Session 身份', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = createClient(async (method, params) => {
    calls.push({ method, params });
    return {
      questions: [
        pendingQuestion,
        { ...pendingQuestion, id: 'question-2', status: 'cancelled' },
      ],
    };
  });

  assert.deepEqual(await client.list(), [{
    ...pendingQuestion,
    questions: [{
      ...pendingQuestion.questions[0],
      multiSelect: false,
      isOther: false,
      isSecret: false,
    }],
  }]);
  assert.deepEqual(calls, [{ method: 'question.list', params: {} }]);
});

test('resolve 原样提交普通答案并核验结构化成功响应', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = createClient(async (method, params) => {
    calls.push({ method, params });
    return { status: 'answered', answers: { answers: { deployment: ['Native'] } } };
  });

  const result = await client.resolve('question-1', { deployment: ['Native'] });

  assert.deepEqual(result, {
    status: 'answered',
    answers: { deployment: ['Native'] },
  });
  assert.deepEqual(calls, [{
    method: 'question.resolve',
    params: {
      id: 'question-1',
      answers: { answers: { deployment: ['Native'] } },
    },
  }]);
});

test('resolve 仅在当次 RPC 参数携带密钥允许主机', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = createClient(async (method, params) => {
    calls.push({ method, params });
    return { status: 'answered', answers: { answers: { api_key: ['stored'] } } };
  });

  await client.resolve(
    'question-secret',
    { api_key: ['sensitive-value'] },
    ['api.example.com'],
  );

  assert.deepEqual(calls, [{
    method: 'question.resolve',
    params: {
      id: 'question-secret',
      answers: { answers: { api_key: ['sensitive-value'] } },
      secretStoreAllowedHosts: ['api.example.com'],
    },
  }]);
});

test('拒绝协议外的问题结构', async () => {
  const client = createClient(async () => ({
    questions: [{
      ...pendingQuestion,
      questions: [{ ...pendingQuestion.questions[0], options: [{ label: 'Only' }] }],
    }],
  }));

  await assert.rejects(() => client.list(), OpenClawQuestionResponseError);
});
