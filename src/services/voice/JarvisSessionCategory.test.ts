import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignJarvisSessionCategory,
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

test('Jarvis creates the native catalog entry before assigning session category', async () => {
  const calls: string[] = [];
  const category = await assignJarvisSessionCategory({
    createSessionGroup: async (label) => { calls.push(`group:${label}`); },
    setSessionCategory: async (label, sessionKey) => { calls.push(`category:${label}:${sessionKey}`); },
  }, 'agent:main:main', 'JunQi');

  assert.equal(category, 'Jarvis: JunQi');
  assert.deepEqual(calls, [
    'group:Jarvis: JunQi',
    'category:Jarvis: JunQi:agent:main:main',
  ]);
});

test('Jarvis does not assign category when native catalog creation fails', async () => {
  let assigned = false;
  await assert.rejects(assignJarvisSessionCategory({
    createSessionGroup: async () => { throw new Error('Gateway unavailable'); },
    setSessionCategory: async () => { assigned = true; },
  }, 'agent:main:main', 'JunQi'));
  assert.equal(assigned, false);
});
