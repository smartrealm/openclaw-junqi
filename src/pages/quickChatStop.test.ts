import assert from 'node:assert/strict';
import test from 'node:test';
import { stopQuickChatRequest } from './quickChatStop';

const SESSION_KEY = 'quickchat:pending-send';
const SESSION_ID = 'session-pending-send';

test('Quick Chat forwards a pending Gateway send to the native Stop facade', async () => {
  const calls: Array<[string, string | undefined]> = [];
  const stopped = await stopQuickChatRequest(
    SESSION_KEY,
    SESSION_ID,
    { typingBySession: { [SESSION_KEY]: true } },
    async (sessionKey, sessionId) => {
      calls.push([sessionKey, sessionId]);
    },
  );

  assert.equal(stopped, true);
  assert.deepEqual(calls, [[SESSION_KEY, SESSION_ID]]);
});

test('Quick Chat does not emit an unscoped Stop while the session is idle', async () => {
  let calls = 0;
  const stopped = await stopQuickChatRequest(
    SESSION_KEY,
    SESSION_ID,
    { typingBySession: {} },
    async () => { calls += 1; },
  );

  assert.equal(stopped, false);
  assert.equal(calls, 0);
});
