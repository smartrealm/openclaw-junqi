import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayStateMachine } from './GatewayStateMachine';
import { GatewayState } from './types';

function connect(machine: GatewayStateMachine): void {
  machine.transition({ type: 'STATUS_RECEIVED', running: true, error: null, retrying: false });
  machine.transition({ type: 'WS_OPEN' });
  assert.equal(machine.current, GatewayState.CONNECTED);
}

test('BUG-GSC02 status observation does not start an offline process', () => {
  const machine = new GatewayStateMachine();
  connect(machine);
  const result = machine.transition({
    type: 'STATUS_RECEIVED',
    running: false,
    error: null,
    retrying: false,
  });
  assert.equal(result.state, GatewayState.DETECTING);
  assert.deepEqual(result.actions, []);
});

test('BUG-GSC02 connected enters ERROR when the process reports an error', () => {
  const machine = new GatewayStateMachine();
  connect(machine);
  const result = machine.transition({
    type: 'STATUS_RECEIVED',
    running: false,
    error: 'gateway failed',
    retrying: false,
  });
  assert.equal(result.state, GatewayState.ERROR);
  assert.deepEqual(result.actions, ['SHOW_ERROR']);
});

test('BUG-GSC03 retrying has priority over a stale connected snapshot', () => {
  const machine = new GatewayStateMachine();
  connect(machine);
  const result = machine.transition({
    type: 'STATUS_RECEIVED',
    running: false,
    error: null,
    retrying: true,
  });
  assert.equal(result.state, GatewayState.DETECTING);
  assert.equal(machine.snapshot(null, true).connected, false);
});

test('healthy process polling does not downgrade CONNECTED', () => {
  const machine = new GatewayStateMachine();
  connect(machine);
  const result = machine.transition({
    type: 'STATUS_RECEIVED',
    running: true,
    error: null,
    retrying: false,
  });
  assert.equal(result.state, GatewayState.CONNECTED);
  assert.deepEqual(result.actions, ['NONE']);
});
