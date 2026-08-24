import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBusinessActivityPrimaryState } from './businessActivityPresentation';

test('官方审计失败与成功空结果使用互斥主状态', () => {
  assert.deepEqual(resolveBusinessActivityPrimaryState({
    hasAnyActivity: false,
    loading: false,
    failure: 'failed',
  }), { kind: 'failure', failure: 'failed' });

  assert.deepEqual(resolveBusinessActivityPrimaryState({
    hasAnyActivity: false,
    loading: false,
    failure: null,
  }), { kind: 'empty' });
});

test('已有投影时保留内容区并把官方失败降为非阻断提示', () => {
  assert.deepEqual(resolveBusinessActivityPrimaryState({
    hasAnyActivity: true,
    loading: false,
    failure: 'unauthorized',
  }), { kind: 'content' });
});

test('首次读取期间不提前下空结果结论', () => {
  assert.deepEqual(resolveBusinessActivityPrimaryState({
    hasAnyActivity: false,
    loading: true,
    failure: null,
  }), { kind: 'loading' });
});
