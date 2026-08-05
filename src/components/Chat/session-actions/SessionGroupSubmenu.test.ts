import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionGroupSubmenuPlacement } from './SessionGroupSubmenu';

test('session group submenu opens on the side with remaining desktop space', () => {
  assert.deepEqual(
    resolveSessionGroupSubmenuPlacement(
      { top: 100, right: 300, bottom: 420, left: 80 },
      { top: 180, right: 300, bottom: 212, left: 80 },
      { width: 196, height: 180 },
      { width: 900, height: 720 },
    ),
    { side: 'right', top: 80 },
  );
});

test('session group submenu flips and remains inside the viewport at the right edge', () => {
  assert.deepEqual(
    resolveSessionGroupSubmenuPlacement(
      { top: 500, right: 860, bottom: 650, left: 632 },
      { top: 620, right: 860, bottom: 652, left: 632 },
      { width: 196, height: 180 },
      { width: 900, height: 720 },
    ),
    { side: 'left', top: 32 },
  );
});
