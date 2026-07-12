import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeaf, type PaneSplit } from '@/workspace/types';
import { paneNodeContains, resolvePaneSplitLayout, zoomedBranchForSplit } from './paneTreeLayout';

const left = createLeaf({ kind: 'shell' }, 'left');
const nestedTop = createLeaf({ kind: 'shell' }, 'nested-top');
const nestedBottom = createLeaf({ kind: 'shell' }, 'nested-bottom');
const nested: PaneSplit = {
  type: 'split',
  id: 'nested',
  direction: 'vertical',
  sizes: [0.4, 0.6],
  children: [nestedTop, nestedBottom],
};
const root: PaneSplit = {
  type: 'split',
  id: 'root',
  direction: 'horizontal',
  sizes: [0.5, 0.5],
  children: [left, nested],
};

test('zoom resolves the target branch at every level of a nested split', () => {
  assert.equal(zoomedBranchForSplit(root, 'nested-bottom'), 'second');
  assert.equal(zoomedBranchForSplit(nested, 'nested-bottom'), 'second');
  assert.equal(paneNodeContains(root, 'nested-bottom'), true);
  assert.deepEqual(resolvePaneSplitLayout(root, 'nested-bottom'), {
    firstFlex: 0,
    secondFlex: 1,
    // Zoom retains the collapsed terminal in the DOM so restoring it does not
    // recreate xterm or flash its scrollback.
    firstVisible: true,
    secondVisible: true,
    splitterVisible: false,
  });
});

test('an absent or stale zoom target leaves the stored split layout intact', () => {
  assert.equal(zoomedBranchForSplit(root, null), null);
  assert.equal(zoomedBranchForSplit(root, 'missing-pane'), null);
  assert.equal(paneNodeContains(root, 'missing-pane'), false);
  assert.deepEqual(resolvePaneSplitLayout(root, 'missing-pane', 0.35), {
    firstFlex: 0.35,
    secondFlex: 0.65,
    firstVisible: true,
    secondVisible: true,
    splitterVisible: true,
  });
});

test('stored split sizes use Kooky\'s 10% minimum pane fraction', () => {
  assert.deepEqual(resolvePaneSplitLayout({ ...root, sizes: [0.1, 0.9] }, null), {
    firstFlex: 0.1,
    secondFlex: 0.9,
    firstVisible: true,
    secondVisible: true,
    splitterVisible: true,
  });
});
