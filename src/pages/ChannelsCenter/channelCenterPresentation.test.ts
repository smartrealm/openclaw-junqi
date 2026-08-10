import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getChannelAttentionCount,
  shouldShowChannelCenterSkeleton,
} from './channelCenterPresentation';

test('首次读取运行时或配置时显示渠道骨架', () => {
  assert.equal(shouldShowChannelCenterSkeleton({
    runtimeLoaded: false,
    loadingConfig: true,
    hasConfig: false,
  }), true);
  assert.equal(shouldShowChannelCenterSkeleton({
    runtimeLoaded: true,
    loadingConfig: true,
    hasConfig: false,
  }), true);
});

test('已有配置的后台刷新保留渠道内容', () => {
  assert.equal(shouldShowChannelCenterSkeleton({
    runtimeLoaded: true,
    loadingConfig: true,
    hasConfig: true,
  }), false);
});

test('需要处理数量不会因运行时状态漂移变为负数', () => {
  assert.equal(getChannelAttentionCount(4, 1), 3);
  assert.equal(getChannelAttentionCount(1, 2), 0);
});
