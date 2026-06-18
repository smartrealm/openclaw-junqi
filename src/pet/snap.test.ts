import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSnapTarget, easeOutCubic, type PetBounds } from './snap';

const BOUNDS: PetBounds = { monX: 0, monY: 0, monW: 1000, monH: 800 };
const SIZE = { w: 100, h: 100 };
const THRESHOLD = 90;
const MARGIN = 6;

test('mid-screen → no snap', () => {
  assert.equal(computeSnapTarget({ x: 450, y: 350, ...SIZE }, BOUNDS, THRESHOLD, MARGIN), null);
});

test('near left edge → snap left (x only)', () => {
  assert.deepEqual(computeSnapTarget({ x: 10, y: 350, ...SIZE }, BOUNDS, THRESHOLD, MARGIN), { x: 6, y: 350 });
});

test('near right edge → snap right (x only)', () => {
  assert.deepEqual(computeSnapTarget({ x: 920, y: 350, ...SIZE }, BOUNDS, THRESHOLD, MARGIN), { x: 894, y: 350 });
});

test('near bottom edge → snap bottom (y only)', () => {
  assert.deepEqual(computeSnapTarget({ x: 450, y: 720, ...SIZE }, BOUNDS, THRESHOLD, MARGIN), { x: 450, y: 694 });
});

test('inside threshold snaps, outside does not', () => {
  // center x = 50 → dLeft = 50 < 90 → snap
  assert.notEqual(computeSnapTarget({ x: 0, y: 350, ...SIZE }, BOUNDS, THRESHOLD, MARGIN), null);
  // center x = 200 → every edge > 90 away → no snap
  assert.equal(computeSnapTarget({ x: 150, y: 350, ...SIZE }, BOUNDS, THRESHOLD, MARGIN), null);
});

test('offset monitor origin is respected', () => {
  const b: PetBounds = { monX: 100, monY: 50, monW: 1000, monH: 800 };
  // pet near that monitor's left edge: center x = 110, dLeft = 10
  assert.deepEqual(computeSnapTarget({ x: 60, y: 400, ...SIZE }, b, THRESHOLD, MARGIN), { x: 106, y: 400 });
});

test('easeOutCubic endpoints + fast-start shape', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5); // 0.875 — eases out, not linear
});
