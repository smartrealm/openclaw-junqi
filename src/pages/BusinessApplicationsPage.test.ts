import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBusinessApplicationsView } from '@/business-applications/businessApplicationsView';

test('业务应用视图默认展示有效工具', () => {
  assert.equal(parseBusinessApplicationsView(''), 'tools');
  assert.equal(parseBusinessApplicationsView('?view=tools'), 'tools');
});

test('业务应用视图接受稳定的审计与接入入口', () => {
  assert.equal(parseBusinessApplicationsView('?view=activity'), 'activity');
  assert.equal(parseBusinessApplicationsView('?view=runtime'), 'runtime');
});

test('业务应用视图不会为未知查询创造新状态', () => {
  assert.equal(parseBusinessApplicationsView('?view=unknown'), 'tools');
});
