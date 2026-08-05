import assert from 'node:assert/strict';
import test from 'node:test';
import { readSessionCompanionCommand } from './sessionCompanionUi';

test('only official Control UI /btw and /side forms become companion questions', () => {
  assert.equal(readSessionCompanionCommand('/btw what changed?'), 'what changed?');
  assert.equal(readSessionCompanionCommand(' /SIDE: explain this '), 'explain this');
  assert.equal(readSessionCompanionCommand('/btw'), '');
  assert.equal(readSessionCompanionCommand('/btw-not-a-command'), null);
  assert.equal(readSessionCompanionCommand('please /btw explain'), null);
});
