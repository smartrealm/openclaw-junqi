import assert from 'node:assert/strict';
import test from 'node:test';
import {
  settlePrivilegedAuthorizationIssueAfterReconnect,
  shouldPresentMainGatewayAuthorizationIssue,
} from './privilegedAuthorizationState';

const scopeDeniedIssue = {
  kind: 'scope_denied' as const,
  code: 'MISSING_SCOPE',
  message: 'operator.admin is required',
  missingScope: 'operator.admin',
};

test('主连接权限不足不能进入管理员批准弹窗', () => {
  assert.equal(shouldPresentMainGatewayAuthorizationIssue(scopeDeniedIssue), false);
  assert.equal(shouldPresentMainGatewayAuthorizationIssue({
    kind: 'pairing_required',
    code: 'PAIRING_REQUIRED',
    message: 'pairing required',
  }), true);
});

test('已核验重连后没有待恢复操作会清除旧授权提示', () => {
  assert.equal(
    settlePrivilegedAuthorizationIssueAfterReconnect(scopeDeniedIssue, false),
    null,
  );
});

test('已核验重连后仍有待恢复操作会保留授权提示直到真实成功', () => {
  assert.equal(
    settlePrivilegedAuthorizationIssueAfterReconnect(scopeDeniedIssue, true),
    scopeDeniedIssue,
  );
});
