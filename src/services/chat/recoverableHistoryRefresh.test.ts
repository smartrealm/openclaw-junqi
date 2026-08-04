import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleRecoverableSessionHistoryRefresh } from './recoverableHistoryRefresh';

test('active leaf 的后台历史刷新在所属会话内报告失败', async () => {
  const failure = new Error('history unavailable');
  const calls: Array<{ sessionKey: string; options: { force: true; background: true } }> = [];
  let reported: { sessionKey: string; error: unknown } | null = null;
  scheduleRecoverableSessionHistoryRefresh(
    'agent:main:session-1',
    async (sessionKey, options) => {
      calls.push({ sessionKey, options });
      throw failure;
    },
    (sessionKey, error) => { reported = { sessionKey, error }; },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [{
    sessionKey: 'agent:main:session-1',
    options: { force: true, background: true },
  }]);
  assert.deepEqual(reported, { sessionKey: 'agent:main:session-1', error: failure });
});
