import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayThinkingLevelLabel,
  parseGatewaySessionThinkingProfile,
  parseGatewayThinkingLevels,
} from './sessionThinkingProfile';

test('Gateway 思考能力集保留 provider 下发的 id 和显示标签', () => {
  assert.deepEqual(parseGatewayThinkingLevels([
    { id: 'low', label: 'On' },
    { id: 'max', label: 'Maximum' },
  ]), [
    { id: 'low', label: 'On' },
    { id: 'max', label: 'Maximum' },
  ]);
});

test('Gateway 思考能力集拒绝不完整或重复的条目', () => {
  assert.deepEqual(parseGatewayThinkingLevels([
    { id: 'high', label: 'High' },
    { id: 'high', label: 'Highest' },
    { id: 'off' },
    null,
  ]), [{ id: 'high', label: 'High' }]);
  assert.equal(parseGatewayThinkingLevels([]), null);
});

test('思考等级展示优先使用 Gateway 的 provider 标签', () => {
  const levels = [{ id: 'low', label: 'On' }];
  assert.equal(gatewayThinkingLevelLabel('low', levels), 'On');
  assert.equal(gatewayThinkingLevelLabel('xhigh', levels), 'xhigh');
  assert.equal(gatewayThinkingLevelLabel(null, levels), null);
});

test('会话思考投影不把缺失 profile 猜测为固定等级', () => {
  assert.deepEqual(parseGatewaySessionThinkingProfile({
    thinkingLevel: ' xhigh ',
    thinkingLevels: [{ id: 'xhigh', label: 'Extra high' }],
    thinkingDefault: 'xhigh',
  }), {
    level: 'xhigh',
    levels: [{ id: 'xhigh', label: 'Extra high' }],
    defaultLevel: 'xhigh',
  });
  assert.deepEqual(parseGatewaySessionThinkingProfile({ thinkingLevel: 42 }), {
    level: null,
    levels: null,
    defaultLevel: null,
  });
});
