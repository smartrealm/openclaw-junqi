import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationTrackForPet, frameAtElapsed, lookCellForVector, spriteBackgroundGeometry } from './customPetAnimation';

test('maps work, waiting, failure and celebration to v2 rows', () => {
  assert.equal(animationTrackForPet({ emotion: 'working', dragging: false, hovered: false, walkDir: 0 }).row, 7);
  assert.equal(animationTrackForPet({ emotion: 'thinking', dragging: false, hovered: false, walkDir: 0 }).row, 6);
  assert.equal(animationTrackForPet({ emotion: 'error', dragging: false, hovered: false, walkDir: 0 }).row, 5);
  assert.equal(animationTrackForPet({ emotion: 'celebrate', dragging: false, hovered: false, walkDir: 0 }).row, 4);
});

test('dragging selects the correct directional locomotion row', () => {
  assert.equal(animationTrackForPet({ emotion: 'idle', dragging: true, hovered: false, walkDir: -1 }).row, 2);
  assert.equal(animationTrackForPet({ emotion: 'idle', dragging: true, hovered: false, walkDir: 1 }).row, 1);
});

test('look vectors map clockwise across both v2 direction rows', () => {
  assert.deepEqual(lookCellForVector(0, -20), { row: 9, column: 0 });
  assert.deepEqual(lookCellForVector(20, 0), { row: 9, column: 4 });
  assert.deepEqual(lookCellForVector(0, 20), { row: 10, column: 0 });
  assert.deepEqual(lookCellForVector(-20, 0), { row: 10, column: 4 });
  assert.equal(lookCellForVector(2, 2), null);
});

test('non-looping tracks hold their final frame', () => {
  const failed = animationTrackForPet({ emotion: 'error', dragging: false, hovered: false, walkDir: 0 });
  assert.equal(frameAtElapsed(failed, 60_000), failed.durations.length - 1);
});

test('scales a 192x208 atlas cell to the pet window without changing its aspect ratio', () => {
  assert.deepEqual(spriteBackgroundGeometry(7, 3), {
    width: 96,
    height: 104,
    backgroundSize: '768px 1144px',
    backgroundPosition: '-288px -728px',
  });
});
