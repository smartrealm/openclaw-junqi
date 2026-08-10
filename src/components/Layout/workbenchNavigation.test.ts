import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWorkbenchNavigationItemActive,
  WORKBENCH_NAVIGATION_ITEMS,
} from './workbenchNavigation';

test('workbench exposes the complete primary navigation in a stable order', () => {
  assert.deepEqual(
    WORKBENCH_NAVIGATION_ITEMS.map(({ key, to }) => ({ key, to })),
    [
      { key: 'agents', to: '/agents' },
      { key: 'models', to: '/config?tab=providers' },
      { key: 'channels', to: '/channels' },
      { key: 'cron', to: '/cron' },
    ],
  );
});

test('workbench navigation resolves active routes without substring matches', () => {
  const models = WORKBENCH_NAVIGATION_ITEMS.find((item) => item.key === 'models');
  const channels = WORKBENCH_NAVIGATION_ITEMS.find((item) => item.key === 'channels');
  assert.ok(models);
  assert.ok(channels);

  assert.equal(isWorkbenchNavigationItemActive(models, '/config', '?tab=providers'), true);
  assert.equal(isWorkbenchNavigationItemActive(models, '/config', '?tab=advanced'), false);
  assert.equal(isWorkbenchNavigationItemActive(channels, '/channels/accounts', ''), true);
  assert.equal(isWorkbenchNavigationItemActive(channels, '/channel-settings', ''), false);
});
