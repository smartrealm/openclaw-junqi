import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from '@/services/gateway/Connection';
import { OpenClawAuditUnsupportedError } from '@/services/gateway/OpenClawAuditClient';
import { OpenClawAuditResponseError } from '@/services/gateway/OpenClawAuditActivityCodec';
import { buildDingTalkAuditQuery, classifyDingTalkAuditFailure } from './dingtalkAuditAvailability';

test('区分连接、方法、权限和响应契约错误', () => {
  assert.equal(classifyDingTalkAuditFailure(false, new Error('ignored')), 'disconnected');
  assert.equal(classifyDingTalkAuditFailure(true, new OpenClawAuditUnsupportedError()), 'unsupported');
  assert.equal(classifyDingTalkAuditFailure(true, new GatewayRpcError('missing operator.read', 'UNAUTHORIZED')), 'unauthorized');
  assert.equal(classifyDingTalkAuditFailure(true, new GatewayRpcError('forbidden', 'FORBIDDEN')), 'unauthorized');
  assert.equal(classifyDingTalkAuditFailure(true, new OpenClawAuditResponseError()), 'invalid-response');
  assert.equal(classifyDingTalkAuditFailure(true, new Error('network')), 'failed');
});

test('审计查询必须绑定精确 Session，游标只用于同一 Session 翻页', () => {
  assert.equal(buildDingTalkAuditQuery('  '), null);
  assert.deepEqual(buildDingTalkAuditQuery('agent:main:main'), {
    kind: 'tool_action',
    sessionKey: 'agent:main:main',
    limit: 100,
  });
  assert.deepEqual(buildDingTalkAuditQuery('agent:main:main', 'next-page'), {
    kind: 'tool_action',
    sessionKey: 'agent:main:main',
    limit: 100,
    cursor: 'next-page',
  });
});
