import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./MessageBubble.tsx', import.meta.url), 'utf8');

test('message action buttons preserve desktop density and expose a 40px coarse-pointer target', () => {
  assert.match(source, /w-7 h-7/);
  assert.match(source, /\[@media\(pointer:coarse\)\]:h-\[40px\]/);
  assert.match(source, /\[@media\(pointer:coarse\)\]:w-\[40px\]/);
});
