import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOpenClawChatSendDeliveryUncertain,
  parseOpenClawChatRunStartup,
  resolveOpenClawChatDeltaText,
} from './openClawChatEvent';

test('只把带稳定运行标识的未确认投递结果视为待核验', () => {
  assert.equal(isOpenClawChatSendDeliveryUncertain({
    deliveryUncertain: true,
    runId: 'run-one',
  }), true);
  assert.equal(isOpenClawChatSendDeliveryUncertain({
    deliveryUncertain: true,
  }), false);
  assert.equal(isOpenClawChatSendDeliveryUncertain({
    deliveryUncertain: false,
    runId: 'run-one',
  }), false);
});

test('按 OpenClaw 官方增量规则合并 deltaText、快照和替换事件', () => {
  assert.equal(resolveOpenClawChatDeltaText(null, {
    deltaText: '你',
    snapshotText: null,
  }), '你');
  assert.equal(resolveOpenClawChatDeltaText('你', {
    deltaText: '好',
    snapshotText: '你好',
  }), '你好');
  assert.equal(resolveOpenClawChatDeltaText('旧内容', {
    deltaText: '新内容',
    replace: true,
    snapshotText: '不应覆盖替换字段',
  }), '新内容');
  assert.equal(resolveOpenClawChatDeltaText('旧前缀', {
    deltaText: '后缀',
    snapshotText: '服务端校正内容',
  }), '服务端校正内容');
  assert.equal(resolveOpenClawChatDeltaText(null, {
    snapshotText: '完整快照',
  }), '完整快照');
});

test('只接受 OpenClaw 官方启动阶段', () => {
  assert.deepEqual(parseOpenClawChatRunStartup({
    state: 'status',
    runId: 'run-one',
    phase: 'preparing_context',
  }), {
    runId: 'run-one',
    phase: 'preparing_context',
  });
  assert.equal(parseOpenClawChatRunStartup({
    state: 'status',
    runId: 'run-one',
    phase: 'invented_phase',
  }), null);
});
