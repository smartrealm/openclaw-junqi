import assert from 'node:assert/strict';
import test from 'node:test';
import type { DingTalkEventConfiguration } from '@/business-applications/dingtalkEventConfiguration';
import {
  canSaveDingTalkEventConfiguration,
  createDingTalkEventSubscription,
  isDingTalkEventConfigurationValid,
} from './dingTalkEventSettingsState';

test('新增订阅按事件目标类别生成最小合法草稿', () => {
  assert.deepEqual(createDingTalkEventSubscription('oa'), {
    category: 'oa',
    eventKeys: ['user_oa_approval_task_created'],
  });
  assert.deepEqual(createDingTalkEventSubscription('im-user'), {
    category: 'im-user',
    eventKeys: ['user_im_message_receive_o2o'],
    user: '',
  });
  assert.deepEqual(createDingTalkEventSubscription('im-group'), {
    category: 'im-group',
    eventKeys: ['user_im_message_receive_group'],
    group: '',
  });
});

test('只有发生改动且配置完整时才允许保存', () => {
  const valid: DingTalkEventConfiguration = {
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [{
      category: 'oa',
      eventKeys: ['user_oa_approval_task_created'],
    }],
  };
  const invalid = { ...valid, subscriptions: [] };

  assert.equal(isDingTalkEventConfigurationValid(valid), true);
  assert.equal(isDingTalkEventConfigurationValid(invalid), false);
  assert.equal(canSaveDingTalkEventConfiguration(valid, false), false);
  assert.equal(canSaveDingTalkEventConfiguration(valid, true), true);
  assert.equal(canSaveDingTalkEventConfiguration(invalid, true), false);
});
