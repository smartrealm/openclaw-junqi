import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearTerminalPtyHandoffs,
  completeTerminalPtyHandoff,
  createTerminalRendererInstanceId,
  prepareTerminalPtyHandoff,
  registerTerminalPtyOwner,
  terminalTransferMatchesRemote,
  takeTerminalPtyHandoffSnapshot,
} from './terminalPtyHandoff';

test('only the registered outgoing renderer can retain a PTY during a handoff', () => {
  clearTerminalPtyHandoffs();
  const source = createTerminalRendererInstanceId();
  const destination = createTerminalRendererInstanceId();
  registerTerminalPtyOwner('shell-1', 'run-1', source);

  assert.equal(prepareTerminalPtyHandoff('shell-1', 'run-1'), true);
  assert.equal(completeTerminalPtyHandoff('shell-1', 'run-1', destination, 'ignored'), false);
  assert.equal(completeTerminalPtyHandoff('shell-1', 'run-1', source, '\u001b[31mhistory'), true);
  assert.equal(takeTerminalPtyHandoffSnapshot('shell-1', 'run-1'), '\u001b[31mhistory');
  assert.equal(takeTerminalPtyHandoffSnapshot('shell-1', 'run-1'), null);
});

test('handoff preparation rejects a stale PTY run id', () => {
  clearTerminalPtyHandoffs();
  const source = createTerminalRendererInstanceId();
  registerTerminalPtyOwner('shell-1', 'run-current', source);

  assert.equal(prepareTerminalPtyHandoff('shell-1', 'run-stale'), false);
});

test('live terminal transfers retain their SSH ownership boundary', () => {
  assert.equal(terminalTransferMatchesRemote(undefined, undefined), true);
  assert.equal(terminalTransferMatchesRemote('dev@bastion', 'dev@bastion'), true);
  assert.equal(terminalTransferMatchesRemote(' dev@bastion ', 'dev@bastion'), true);
  assert.equal(terminalTransferMatchesRemote('dev@bastion', undefined), false);
  assert.equal(terminalTransferMatchesRemote('dev@bastion', 'prod@bastion'), false);
});
