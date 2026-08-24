import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDingTalkAuthorizationTargets } from './dingtalkAuthorizationTarget';

test('授权对象保留当前 Agent 并允许选择其他已发现 Agent', () => {
  assert.deepEqual(
    collectDingTalkAuthorizationTargets('main', [
      { id: 'reviewer', name: '审查 Agent' },
      { id: 'main', name: '主 Agent' },
      { id: 'reviewer', name: '重复项' },
    ]),
    [
      { id: 'main', name: '主 Agent' },
      { id: 'reviewer', name: '审查 Agent' },
    ],
  );
  assert.deepEqual(
    collectDingTalkAuthorizationTargets('main', [{ id: 'reviewer' }]),
    [{ id: 'main' }, { id: 'reviewer' }],
  );
});
