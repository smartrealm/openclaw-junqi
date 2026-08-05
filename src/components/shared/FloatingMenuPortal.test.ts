import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFloatingMenuPosition } from './FloatingMenuPortal';

test('floating menus stay fully inside the desktop viewport', () => {
  assert.deepEqual(
    resolveFloatingMenuPosition(
      { x: 4, y: 590 },
      { width: 240, height: 180 },
      { width: 800, height: 700 },
    ),
    { x: 8, y: 512 },
  );
});

test('end-aligned menu anchors its right edge before applying collision limits', () => {
  assert.deepEqual(
    resolveFloatingMenuPosition(
      { x: 780, y: 40 },
      { width: 240, height: 180 },
      { width: 800, height: 700 },
      'top-end',
    ),
    { x: 540, y: 40 },
  );
});
