import assert from 'node:assert/strict';
import test from 'node:test';
import { initialStorageCompletion } from './storageSetupModel';

const configured = {
  configured: true,
  openclawRelocationRequired: false,
};

test('configured storage can continue without rewriting an unchanged layout', () => {
  assert.deepEqual(initialStorageCompletion(configured, false, false), {
    createdFresh: false,
    openclawRelocationRequired: false,
  });
});

test('forced storage recovery cannot continue without submitting a new layout', () => {
  assert.equal(initialStorageCompletion(configured, false, true), null);
});

test('an in-progress storage draft must be explicitly submitted', () => {
  assert.equal(initialStorageCompletion(configured, true, false), null);
});
