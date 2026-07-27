import assert from 'node:assert/strict';
import test from 'node:test';

import { extractOpenClawTerminalQr } from './openclawTerminalQr';

const qrLines = Array.from({ length: 8 }, (_, index) => (
  `\x1b[47m\x1b[30m ${index % 2 === 0 ? '\u2588\u2580\u2584'.repeat(6) : '\u2584\u2588\u2580'.repeat(6)} \x1b[0m`
));

test('extracts a provider-neutral terminal QR matrix from ANSI Gateway output', () => {
  const matrix = extractOpenClawTerminalQr(['gateway ready', ...qrLines, 'polling']);

  assert.ok(matrix);
  assert.equal(matrix.length, 16);
  assert.ok(matrix[0].length >= 17);
  assert.equal(matrix.some((row) => row.some(Boolean)), true);
});

test('does not mistake normal block-character logs for a QR code', () => {
  assert.equal(extractOpenClawTerminalQr(['progress \u2588\u2588\u2588 50%', 'ready']), null);
});
