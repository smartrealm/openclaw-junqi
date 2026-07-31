import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGatewaySelfRescuePresentation } from './gatewaySelfRescuePresentation';

test('keeps repair and diagnostics out of a healthy connected Gateway surface', () => {
  assert.deepEqual(projectGatewaySelfRescuePresentation({ connected: true, busy: false }), {
    mode: 'healthy',
    showProgress: false,
    showRecoveryActions: false,
  });
});

test('shows progress only for an active recovery operation', () => {
  assert.deepEqual(projectGatewaySelfRescuePresentation({ connected: true, busy: true }), {
    mode: 'recovering',
    showProgress: true,
    showRecoveryActions: false,
  });
});

test('shows recovery actions when disconnected or carrying an actual failure', () => {
  assert.equal(projectGatewaySelfRescuePresentation({ connected: false, busy: false }).showRecoveryActions, true);
  assert.equal(projectGatewaySelfRescuePresentation({
    connected: true,
    busy: false,
    error: 'Gateway restart failed.',
  }).showRecoveryActions, true);
});
