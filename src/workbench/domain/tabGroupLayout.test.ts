import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampSplitRatio,
  listTabGroupIds,
  removeTabGroup,
  resizeTabGroupSplit,
  splitTabGroup,
} from './tabGroupLayout';
import type { TabGroupLayoutNode } from './types';

const root: TabGroupLayoutNode = { type: 'group', groupId: 'main' };

test('tab group layout recursively splits and preserves deterministic order', () => {
  const horizontal = splitTabGroup(root, 'main', 'split-1', 'right', 'horizontal');
  const nested = splitTabGroup(horizontal, 'right', 'split-2', 'bottom-right', 'vertical', 'before');
  assert.deepEqual(listTabGroupIds(nested), ['main', 'bottom-right', 'right']);
});

test('removing a group collapses redundant split nodes', () => {
  const split = splitTabGroup(root, 'main', 'split-1', 'right', 'horizontal');
  assert.deepEqual(removeTabGroup(split, 'right'), root);
  assert.deepEqual(removeTabGroup(split, 'main'), { type: 'group', groupId: 'right' });
  assert.equal(removeTabGroup(root, 'main'), null);
});

test('split ratios are fenced to the usable 15–85 percent range', () => {
  assert.equal(clampSplitRatio(Number.NaN), 0.5);
  assert.equal(clampSplitRatio(0.01), 0.15);
  assert.equal(clampSplitRatio(0.99), 0.85);
  const split = splitTabGroup(root, 'main', 'split-1', 'right', 'horizontal');
  const resized = resizeTabGroupSplit(split, 'split-1', 0.9);
  assert.equal(resized.type === 'split' ? resized.ratio : null, 0.85);
});
