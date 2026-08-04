import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOpenClawBtwRequestText,
  parseOpenClawBtwSideResult,
} from './openClawBtw';

test('recognizes the current OpenClaw `/btw` request classifier without accepting lookalikes', () => {
  assert.equal(isOpenClawBtwRequestText('/btw summarize this'), true);
  assert.equal(isOpenClawBtwRequestText(' /BTW: summarize this'), true);
  assert.equal(isOpenClawBtwRequestText('/btw'), true);
  assert.equal(isOpenClawBtwRequestText('/btw-not-a-command'), false);
  assert.equal(isOpenClawBtwRequestText('please /btw summarize this'), false);
});

test('decodes only a complete OpenClaw chat.side_result payload', () => {
  const payload = {
    kind: 'btw',
    sessionKey: 'agent:main:main',
    runId: 'btw-run',
    question: 'What changed?',
    text: 'Only the current configuration changed.',
    isError: false,
    ts: 1_773_000_000_000,
  };
  assert.deepEqual(parseOpenClawBtwSideResult(payload), payload);
  assert.equal(parseOpenClawBtwSideResult({ ...payload, isError: 'false' }), null);
  assert.equal(parseOpenClawBtwSideResult({ ...payload, question: ' ' }), null);
  assert.equal(parseOpenClawBtwSideResult({ ...payload, kind: 'other' }), null);
});
