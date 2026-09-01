import assert from 'node:assert/strict';
import test from 'node:test';
import { gateway } from '@/services/gateway';
import { publishGatewayQuestionEvent } from '@/services/gateway/questionEventBridge';
import type { OpenClawPendingQuestion } from '@/services/gateway/OpenClawQuestionClient';
import { useOpenClawQuestionsStore } from './openclawQuestionsStore';

function question(id: string, sessionKey = 'agent:main:desktop'): OpenClawPendingQuestion {
  return {
    id,
    questions: [{
      questionId: 'choice',
      header: '选择',
      question: '请选择',
      options: [{ label: 'A' }, { label: 'B' }],
      multiSelect: false,
      isOther: false,
      isSecret: false,
    }],
    sessionKey,
    createdAtMs: 1,
    expiresAtMs: 10_000,
    status: 'pending',
  };
}

function secretQuestion(id: string): OpenClawPendingQuestion {
  return {
    ...question(id),
    questions: [{
      questionId: 'api_key',
      header: '密钥',
      question: '请输入密钥',
      options: [],
      multiSelect: false,
      isOther: false,
      isSecret: true,
      secretStore: { name: 'PROVIDER_API_KEY', kind: 'secret', allowedHosts: [] },
    }],
  };
}

test('重叠列表请求只保留最新 Gateway 快照', async () => {
  const original = gateway.listPendingQuestions;
  let resolveFirst!: (value: readonly OpenClawPendingQuestion[]) => void;
  let resolveSecond!: (value: readonly OpenClawPendingQuestion[]) => void;
  let calls = 0;
  gateway.listPendingQuestions = async () => new Promise((resolve) => {
    calls += 1;
    if (calls === 1) resolveFirst = resolve;
    else resolveSecond = resolve;
  });
  useOpenClawQuestionsStore.setState({
    questions: [],
    loading: false,
    error: null,
    errorRequestId: null,
    resolvingId: null,
  });

  try {
    const first = useOpenClawQuestionsStore.getState().refresh(true, true);
    const second = useOpenClawQuestionsStore.getState().refresh(true, true);
    resolveSecond([question('new')]);
    await second;
    resolveFirst([question('old')]);
    await first;
    assert.deepEqual(useOpenClawQuestionsStore.getState().questions.map((item) => item.id), ['new']);
  } finally {
    gateway.listPendingQuestions = original;
  }
});

test('requested 事件新增问题，resolved 事件按 id 原子移除', () => {
  useOpenClawQuestionsStore.setState({
    questions: [],
    loading: false,
    error: null,
    errorRequestId: null,
    resolvingId: null,
  });

  const release = useOpenClawQuestionsStore.getState().subscribeLiveUpdates(true);
  publishGatewayQuestionEvent({
    type: 'event',
    event: 'question.requested',
    payload: question('question-1'),
  });
  assert.deepEqual(useOpenClawQuestionsStore.getState().questions.map((item) => item.id), ['question-1']);
  publishGatewayQuestionEvent({
    type: 'event',
    event: 'question.resolved',
    payload: { id: 'question-1', status: 'answered', answers: { answers: { choice: ['A'] } } },
  });
  assert.deepEqual(useOpenClawQuestionsStore.getState().questions, []);
  release();
});

test('密钥答案不进入 Zustand 状态', async () => {
  const originalResolve = gateway.resolveQuestion;
  let releaseResolve!: () => void;
  gateway.resolveQuestion = async () => new Promise((resolve) => {
    releaseResolve = () => resolve({ status: 'answered', answers: { api_key: ['stored'] } });
  });
  useOpenClawQuestionsStore.setState({
    questions: [secretQuestion('question-secret')],
    loading: false,
    error: null,
    errorRequestId: null,
    resolvingId: null,
  });

  try {
    const pending = useOpenClawQuestionsStore.getState().resolve(
      true,
      'question-secret',
      { api_key: ['sensitive-value'] },
      ['api.example.com'],
    );
    const serializedState = JSON.stringify(useOpenClawQuestionsStore.getState());
    assert.equal(serializedState.includes('sensitive-value'), false);
    releaseResolve();
    await pending;
    assert.deepEqual(useOpenClawQuestionsStore.getState().questions, []);
  } finally {
    gateway.resolveQuestion = originalResolve;
  }
});

test('问题提交失败只关联当前请求', async () => {
  const originalResolve = gateway.resolveQuestion;
  gateway.resolveQuestion = async () => {
    throw new Error('REQUEST_REJECTED');
  };
  useOpenClawQuestionsStore.setState({
    questions: [question('question-1'), question('question-2')],
    loading: false,
    error: null,
    errorRequestId: null,
    resolvingId: null,
  });

  try {
    await useOpenClawQuestionsStore.getState().resolve(
      true,
      'question-2',
      { choice: ['A'] },
    );
    assert.equal(useOpenClawQuestionsStore.getState().error, 'REQUEST_REJECTED');
    assert.equal(useOpenClawQuestionsStore.getState().errorRequestId, 'question-2');
  } finally {
    gateway.resolveQuestion = originalResolve;
  }
});
