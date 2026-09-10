import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DingTalkEventInvalidationNotice } from './DingTalkEventInvalidationNotice';

test('事件通知只显示可读取提示而不声称业务已完成', () => {
  const html = renderToStaticMarkup(createElement(DingTalkEventInvalidationNotice, {
    invalidation: { revision: 12, eventType: 'user_oa_approval_task_created' },
  }));

  assert.match(html, /Latest Gateway event notice/);
  assert.match(html, /Revision 12, type user_oa_approval_task_created/);
  assert.match(html, /does not prove that any business action completed/);
  assert.match(html, /role="status"/);
});

test('没有当前连接通知时不显示伪造的实时状态', () => {
  const html = renderToStaticMarkup(createElement(DingTalkEventInvalidationNotice, {
    invalidation: null,
  }));

  assert.equal(html, '');
});
