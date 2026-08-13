import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayStateMachine } from './GatewayStateMachine';
import { GatewayState } from './types';

function connect(machine: GatewayStateMachine): void {
  machine.transition({
    type: 'STATUS_RECEIVED',
    processAlive: true,
    endpointReady: true,
    error: null,
    retrying: false,
  });
  machine.transition({ type: 'WS_OPEN' });
  assert.equal(machine.current, GatewayState.CONNECTED);
}

test('BUG-GSC02 status observation does not start an offline process', () => {
  const machine = new GatewayStateMachine();
  connect(machine);
  const result = machine.transition({
    type: 'STATUS_RECEIVED',
    processAlive: false,
    endpointReady: false,
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
    processAlive: false,
    endpointReady: false,
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
    processAlive: false,
    endpointReady: false,
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
    processAlive: true,
    endpointReady: true,
    error: null,
    retrying: false,
  });
  assert.equal(result.state, GatewayState.CONNECTED);
  assert.deepEqual(result.actions, ['NONE']);
});

test('健康端点没有显式连接意图时不得自行启动 WebSocket 轮次', () => {
  const machine = new GatewayStateMachine();

  const observed = machine.transition({
    type: 'STATUS_RECEIVED',
    processAlive: true,
    endpointReady: true,
    error: null,
    retrying: false,
  }, { allowConnect: false });

  assert.equal(observed.state, GatewayState.DETECTING);
  assert.deepEqual(observed.actions, ['NONE']);

  machine.transition({ type: 'CONNECT_FAILED', error: 'attempts exhausted' });
  const exhausted = machine.transition({
    type: 'STATUS_RECEIVED',
    processAlive: true,
    endpointReady: true,
    error: null,
    retrying: false,
  }, { allowConnect: false });

  assert.equal(exhausted.state, GatewayState.ERROR);
  assert.deepEqual(exhausted.actions, ['NONE']);
});

test('传输层退避只更新连接状态而不产生新的 CONNECT 动作', () => {
  const machine = new GatewayStateMachine();
  connect(machine);

  const result = machine.markConnectionRetrying();

  assert.equal(result.state, GatewayState.CONNECTING);
  assert.deepEqual(result.actions, []);
});

test('已核验 WS_OPEN 可从瞬时进程错误态恢复为已连接', () => {
  const machine = new GatewayStateMachine();
  machine.transition({ type: 'CONNECT_FAILED', error: 'temporary process error' });

  const result = machine.transition({ type: 'WS_OPEN' });

  assert.equal(result.state, GatewayState.CONNECTED);
  assert.deepEqual(result.actions, []);
});

test('连接目标解析失败进入可见错误态', () => {
  const machine = new GatewayStateMachine();
  machine.transition({ type: 'START_REQUESTED' });
  machine.transition({ type: 'START_SUCCESS' });

  const result = machine.transition({
    type: 'CONNECT_FAILED',
    error: 'selected runtime target unavailable',
  });

  assert.equal(result.state, GatewayState.ERROR);
  assert.deepEqual(result.actions, ['SHOW_ERROR']);
});

test('启动期间端点提前就绪后启动失败仍进入错误态', () => {
  const machine = new GatewayStateMachine();
  machine.transition({ type: 'START_REQUESTED' });
  machine.transition({
    type: 'STATUS_RECEIVED',
    processAlive: true,
    endpointReady: true,
    error: null,
    retrying: false,
  });

  const result = machine.transition({
    type: 'START_FAILED',
    error: 'selected runtime start failed',
  });

  assert.equal(result.state, GatewayState.ERROR);
  assert.deepEqual(result.actions, ['SHOW_ERROR']);
});
