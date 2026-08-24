import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openClawCommandCategoryFromHash,
  openClawCommandCategoryHash,
  resolveOpenClawCommandScrollGroup,
} from './commandScrollSpy';

test('命令页滚动只高亮已经越过粘性页头锚点的最后一个分组', () => {
  const positions = [
    { id: 'status', top: 180 },
    { id: 'tools', top: 620 },
    { id: 'management', top: 1_200 },
  ];

  assert.equal(resolveOpenClawCommandScrollGroup(positions, 144, false), null);
  assert.equal(resolveOpenClawCommandScrollGroup(positions, 200, false), 'status');
  assert.equal(resolveOpenClawCommandScrollGroup(positions, 700, false), 'tools');
});

test('命令页滚动到底部时高亮最后一个真实分组', () => {
  assert.equal(resolveOpenClawCommandScrollGroup([
    { id: 'tools', top: -400 },
    { id: 'uncategorized', top: 720 },
  ], 144, true), 'uncategorized');
  assert.equal(resolveOpenClawCommandScrollGroup([], 144, true), null);
});

test('命令分组 hash 保留类别参数并支持返回目录顶部', () => {
  assert.equal(openClawCommandCategoryHash('tools'), '#category=tools');
  assert.equal(openClawCommandCategoryFromHash('#category=tools'), 'tools');
  assert.equal(openClawCommandCategoryHash(null), '');
  assert.equal(openClawCommandCategoryFromHash(''), null);
});
