import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_ASSISTANT_RESPONSE_MAX_WIDTH } from './chatResponseLayout';

test('Assistant 回答和工具执行过程复用同一响应列宽度', () => {
  assert.equal(CHAT_ASSISTANT_RESPONSE_MAX_WIDTH, 'min(760px, 88%)');
});
