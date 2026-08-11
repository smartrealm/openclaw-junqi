import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
