import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyImageSaveResult } from './ChatImage';

test('image save cancellation is not classified as a failure fallback', () => {
  assert.equal(classifyImageSaveResult({ success: false, canceled: true }), 'cancelled');
  assert.equal(classifyImageSaveResult({ success: false, error: 'Cancelled' }), 'cancelled');
  assert.equal(classifyImageSaveResult({ success: false, error: 'disk full' }), 'failed');
  assert.equal(classifyImageSaveResult({ success: true, path: '/saved/image.png' }), 'saved');
});
