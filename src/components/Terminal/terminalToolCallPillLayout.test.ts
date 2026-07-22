import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTerminalToolCallPillVariant } from './terminalToolCallPillLayout';

test('tool-call pill picks the widest rendered variant that fits', () => {
  assert.equal(selectTerminalToolCallPillVariant({
    availableWidth: 186,
    fullWidth: 186,
    identifierWidth: 104,
  }), 'full');
  assert.equal(selectTerminalToolCallPillVariant({
    availableWidth: 185,
    fullWidth: 186,
    identifierWidth: 104,
  }), 'identifier');
  assert.equal(selectTerminalToolCallPillVariant({
    availableWidth: 103,
    fullWidth: 186,
    identifierWidth: 104,
  }), 'icon');
});

test('tool-call pill keeps the complete variant until DOM measurements arrive', () => {
  assert.equal(selectTerminalToolCallPillVariant({
    availableWidth: null,
    fullWidth: 186,
    identifierWidth: 104,
  }), 'full');
});
