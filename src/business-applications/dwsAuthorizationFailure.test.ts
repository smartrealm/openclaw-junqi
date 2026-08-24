import assert from 'node:assert/strict';
import test from 'node:test';
import type { DwsOperationOutput } from '@/api/tauri-commands';
import { diagnoseDwsAuthorizationFailure } from './dwsAuthorizationFailure';

function events(lines: readonly string[]): DwsOperationOutput[] {
  return lines.map((line) => ({ operationId: 'dws-auth-1', stream: 'stderr', line }));
}

test('识别旧登录槽位因 DEK 缺失而需要显式重置', () => {
  const diagnosis = diagnoseDwsAuthorizationFailure(events([
    'Waiting for authorization...',
    '{',
    '  "error": {',
    '    "category": "auth",',
    '    "code": 2,',
    '    "message": "dingtalk login failed: Failed to save token: legacy token slot \\"auth-token\\" is unreadable: dek missing"',
    '  }',
    '}',
  ]));

  assert.deepEqual(diagnosis, {
    kind: 'reset-required',
    category: 'auth',
    code: 2,
    stage: 'local-credential-save',
  });
});

test('旧槽位不可读但未证明密钥缺失时只建议迁移', () => {
  const diagnosis = diagnoseDwsAuthorizationFailure(events([
    '{"error":{"category":"auth","code":2,"message":"legacy token slot \\"auth-token\\" is unreadable: keychain unavailable"}}',
  ]));

  assert.deepEqual(diagnosis, {
    kind: 'migration-required',
    category: 'auth',
    code: 2,
    stage: 'unknown',
  });
});

test('不从非结构化文本或无关授权错误推断恢复动作', () => {
  assert.equal(diagnoseDwsAuthorizationFailure(events([
    'legacy token slot "auth-token" is unreadable: dek missing',
  ])), null);
  assert.equal(diagnoseDwsAuthorizationFailure(events([
    '{"error":{"category":"network","code":2,"message":"legacy token slot auth-token is unreadable: dek missing"}}',
  ])), null);
});
