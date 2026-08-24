import assert from 'node:assert/strict';
import test from 'node:test';
import { getCoachmarkPlacement } from './placement';

test('coachmark prefers the space below a target when it fits', () => {
  assert.deepEqual(
    getCoachmarkPlacement(
      { left: 300, top: 100, right: 400, bottom: 140, width: 100, height: 40 },
      { width: 1000, height: 800 },
      { width: 380, height: 240 },
    ),
    { left: 160, top: 154, side: 'bottom' },
  );
});

test('coachmark stays reachable in a narrow viewport', () => {
  const placement = getCoachmarkPlacement(
    { left: 270, top: 560, right: 310, bottom: 600, width: 40, height: 40 },
    { width: 320, height: 640 },
    { width: 296, height: 260 },
  );
  assert.equal(placement.left, 12);
  assert.ok(placement.top >= 12);
  assert.ok(placement.top + 260 <= 628);
});
