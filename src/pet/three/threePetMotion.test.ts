import assert from 'node:assert/strict';
import { test } from 'node:test';
import { animationForThreePet, sampleThreePetPose } from './threePetMotion';

test('three pet covers every business emotion with a continuous animation family', () => {
  const expected = {
    idle: 'idle',
    working: 'work',
    thinking: 'think',
    typing: 'work',
    tool: 'work',
    happy: 'celebrate',
    celebrate: 'celebrate',
    error: 'sad',
    sleepy: 'sleep',
    sleep: 'sleep',
    memory: 'work',
    drag: 'alert',
    overdrag: 'alert',
    swallow: 'chew',
    rapidSwallow: 'chew',
  } as const;

  for (const [emotion, animation] of Object.entries(expected)) {
    assert.equal(animationForThreePet({ emotion: emotion as keyof typeof expected, dragging: false, hovered: false }), animation);
  }
});

test('dragging and idle hover have clear interaction priority', () => {
  assert.equal(animationForThreePet({ emotion: 'celebrate', dragging: true, hovered: true }), 'walk');
  assert.equal(animationForThreePet({ emotion: 'idle', dragging: false, hovered: true }), 'greet');
});

test('three pet clamps external drag coordinates to a stable pose', () => {
  const pose = sampleThreePetPose({
    emotion: 'overdrag',
    dragging: false,
    hovered: false,
    walkDir: 0,
    dragDx: 20_000,
    dragDy: -20_000,
  }, 1200);

  assert.equal(pose.animation, 'alert');
  assert.ok(pose.gazeX <= 0.28 && pose.gazeX >= -0.28);
  assert.ok(pose.gazeY <= 0.2 && pose.gazeY >= -0.2);
  assert.ok(pose.headRoll <= 0.16 && pose.headRoll >= -0.16);
});

test('celebration visibly lifts the character and activates particles', () => {
  const pose = sampleThreePetPose({
    emotion: 'celebrate',
    dragging: false,
    hovered: false,
    walkDir: 0,
    dragDx: 0,
    dragDy: 0,
  }, 150);

  assert.equal(pose.animation, 'celebrate');
  assert.ok(pose.sparkle > 0);
  assert.ok(pose.bodyY > 0);
});
