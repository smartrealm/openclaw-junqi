import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionActionErrorKey } from './sessionActionError';

test('会话操作内部错误码只映射到面向用户的本地化键', () => {
  assert.equal(
    sessionActionErrorKey({ code: 'SESSION_ORGANIZATION_RESPONSE_INVALID' }),
    'chat.sessionActionResponseInvalid',
  );
  assert.equal(
    sessionActionErrorKey({ code: 'SESSION_ORGANIZATION_PROTOCOL_UNSUPPORTED' }),
    'chat.sessionActionUnsupported',
  );
  assert.equal(sessionActionErrorKey(new Error('private gateway detail')), 'chat.sessionActionFailed');
});
