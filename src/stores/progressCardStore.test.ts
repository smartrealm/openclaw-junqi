import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectProgressCardEntry,
  progressCardEntry,
  useProgressCardStore,
} from './progressCardStore';

test('未读取的会话返回稳定空进度卡投影', () => {
  useProgressCardStore.setState({ entries: {} });
  assert.deepEqual(progressCardEntry('agent:main:main'), {
    card: null,
    loading: false,
    error: null,
  });
});

test('旧 Gateway 连接缓存不会投影到当前会话界面', () => {
  const cached = {
    connectionId: 'gateway-old',
    card: null,
    loading: false,
    error: 'request_failed' as const,
  };
  assert.deepEqual(projectProgressCardEntry(cached, 'gateway-current'), {
    card: null,
    loading: false,
    error: null,
  });
  assert.deepEqual(projectProgressCardEntry(cached, 'gateway-old'), {
    card: null,
    loading: false,
    error: 'request_failed',
  });
});
