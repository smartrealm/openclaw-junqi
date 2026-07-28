import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./TabGroupLayout.tsx', import.meta.url), 'utf8');

test('split handles use pointer capture and bounded ratios', () => {
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /hasPointerCapture\(event\.pointerId\)/);
  assert.match(source, /clampSplitRatio\(ratio\)/);
  assert.match(source, /onDoubleClick=\{\(\) => onResize\(node\.id, 0\.5\)\}/);
});
