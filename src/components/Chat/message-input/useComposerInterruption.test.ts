import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStopComposerResponse } from './useComposerInterruption';

const SESSION_KEY = 'agent:main:stop-test';

test('Escape does not treat local sending preflight as a native Gateway run', () => {
  assert.equal(shouldStopComposerResponse({
    typingBySession: {},
    sendingBySession: { [SESSION_KEY]: true },
  }, SESSION_KEY, false), false);
});

test('Escape preserves input recovery when neither a request nor voice output is active', () => {
  assert.equal(shouldStopComposerResponse({
    typingBySession: {},
    sendingBySession: {},
  }, SESSION_KEY, false), false);
});
