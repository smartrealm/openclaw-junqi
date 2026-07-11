import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTerminalDropTargetBounds } from './terminalDropTarget';

test('terminal drop targets convert CSS bounds into WebView-local physical coordinates', () => {
  assert.deepEqual(
    buildTerminalDropTargetBounds(
      'pane-1',
      { left: 24, top: 48, width: 320, height: 200 },
      2,
    ),
    { targetId: 'pane-1', x: 48, y: 96, width: 640, height: 400 },
  );
});

test('terminal drop targets reject hidden or invalid panel bounds', () => {
  assert.equal(
    buildTerminalDropTargetBounds('pane-1', { left: 0, top: 0, width: 0, height: 100 }, 1),
    null,
  );
  assert.equal(
    buildTerminalDropTargetBounds(' ', { left: 0, top: 0, width: 100, height: 100 }, 1),
    null,
  );
});
