import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createJarvisSessionCategory,
  isJarvisSessionCategory,
} from './JarvisSessionCategory';

test('Jarvis categories retain the recognized wake word under one stable prefix', () => {
  assert.equal(createJarvisSessionCategory(' Hey JunQi '), 'Jarvis: Hey JunQi');
  assert.equal(createJarvisSessionCategory('   '), null);
});

test('only non-empty Jarvis categories join the Jarvis session filter', () => {
  assert.equal(isJarvisSessionCategory('Jarvis: Hey JunQi'), true);
  assert.equal(isJarvisSessionCategory('Jarvis: '), false);
  assert.equal(isJarvisSessionCategory('Planning'), false);
});
