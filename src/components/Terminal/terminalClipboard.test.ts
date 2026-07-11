import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTerminalImageMimeType } from './terminalClipboard';

test('terminal clipboard accepts only cacheable image MIME types', () => {
  assert.equal(normalizeTerminalImageMimeType('image/png'), 'image/png');
  assert.equal(normalizeTerminalImageMimeType(' IMAGE/JPG '), 'image/jpeg');
  assert.equal(normalizeTerminalImageMimeType('image/webp'), 'image/webp');
  assert.equal(normalizeTerminalImageMimeType('image/svg+xml'), null);
  assert.equal(normalizeTerminalImageMimeType('text/plain'), null);
});
