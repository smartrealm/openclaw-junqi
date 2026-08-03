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

test('Jarvis assigns the native session category in one Gateway mutation', async () => {
  const calls: string[] = [];
  const category = await assignJarvisSessionCategory({
    setSessionCategory: async (label, sessionKey) => { calls.push(`category:${label}:${sessionKey}`); },
  }, 'agent:main:main', 'JunQi');

  assert.equal(category, 'Jarvis: JunQi');
  assert.deepEqual(calls, ['category:Jarvis: JunQi:agent:main:main']);
});

test('Jarvis fails closed when the native category mutation fails', async () => {
  await assert.rejects(assignJarvisSessionCategory({
    setSessionCategory: async () => { throw new Error('Gateway unavailable'); },
  }, 'agent:main:main', 'JunQi'));
});
