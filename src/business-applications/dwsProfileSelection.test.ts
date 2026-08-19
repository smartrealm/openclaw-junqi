import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveDwsAvatarUrl,
  resolveDwsExecutionProfile,
  resolveDwsIdentitySecondaryLabel,
} from './dwsProfileSelection';

const profiles = [
  { profile: 'corp-a:user-a', isCurrent: true },
  { profile: 'corp-b:user-b', isCurrent: false },
];

test('保留仍存在的精确执行身份', () => {
  assert.equal(resolveDwsExecutionProfile(profiles, 'corp-a:user-a', 'corp-b:user-b'), 'corp-b:user-b');
});

test('空值或已退出账号回落到 DWS 当前 Profile', () => {
  assert.equal(resolveDwsExecutionProfile(profiles, 'corp-a:user-a', ''), 'corp-a:user-a');
  assert.equal(resolveDwsExecutionProfile(profiles, 'corp-a:user-a', 'corp-c:user-c'), 'corp-a:user-a');
});

test('DWS 未返回当前 Profile 时只使用列表中明确标记的当前账号', () => {
  assert.equal(resolveDwsExecutionProfile(profiles, null, ''), 'corp-a:user-a');
  assert.equal(resolveDwsExecutionProfile([], null, 'corp-a:user-a'), '');
});

test('头像只接受 DWS 返回的安全地址，不从姓名生成替代内容', () => {
  assert.equal(resolveDwsAvatarUrl('https://example.com/avatar.png'), 'https://example.com/avatar.png');
  assert.equal(resolveDwsAvatarUrl(' http://example.com/avatar.png '), null);
  assert.equal(resolveDwsAvatarUrl(null), null);
});

test('紧凑身份展示跳过与姓名重复的组织信息并回落到精确 Profile', () => {
  assert.equal(
    resolveDwsIdentitySecondaryLabel('wei', ['wei', 'corp-a:user-a']),
    'corp-a:user-a',
  );
  assert.equal(resolveDwsIdentitySecondaryLabel('wei', [' wei ', null]), null);
});
