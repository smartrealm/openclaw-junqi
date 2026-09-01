import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPendingQuestion } from '@/services/gateway/OpenClawQuestionClient';
import {
  buildOpenClawQuestionAnswers,
  normalizeOpenClawQuestionAllowedHosts,
  openClawQuestionHasAnswer,
} from './openClawQuestionAnswers';

const prompt: OpenClawPendingQuestion = {
  id: 'question-1',
  questions: [{
    questionId: 'deployment',
    header: '部署方式',
    question: '选择本次部署方式',
    options: [{ label: 'Native' }, { label: 'Docker' }],
    multiSelect: false,
    isOther: true,
    isSecret: false,
  }],
  sessionKey: 'agent:main:desktop',
  createdAtMs: 1,
  expiresAtMs: 10_000,
  status: 'pending',
};

test('答案投影按 questionId 组合选项和自定义输入', () => {
  assert.deepEqual(buildOpenClawQuestionAnswers(
    prompt,
    { deployment: ['Native'] },
    { deployment: '自定义环境' },
  ), {
    deployment: ['Native', '自定义环境'],
  });
});

test('允许主机列表去空格、去重并忽略空项', () => {
  assert.deepEqual(
    normalizeOpenClawQuestionAllowedHosts('api.example.com, api.example.com\nfiles.example.com'),
    ['api.example.com', 'files.example.com'],
  );
});

test('空白普通答案不可提交，密钥答案保留原始空格', () => {
  const question = prompt.questions[0];
  assert.ok(question);
  assert.equal(openClawQuestionHasAnswer(question, {}, { deployment: '   ' }), false);
  assert.deepEqual(buildOpenClawQuestionAnswers(prompt, {}, { deployment: '   ' }), {
    deployment: [],
  });

  const secretPrompt: OpenClawPendingQuestion = {
    ...prompt,
    questions: [{
      ...question,
      questionId: 'api_key',
      options: [],
      isOther: false,
      isSecret: true,
      secretStore: { name: 'API_KEY', kind: 'secret' },
    }],
  };
  assert.deepEqual(buildOpenClawQuestionAnswers(secretPrompt, {}, { api_key: ' key ' }), {
    api_key: [' key '],
  });
});
