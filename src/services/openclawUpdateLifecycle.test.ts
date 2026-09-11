import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireOpenclawUpdateMaintenance,
  dispatchOpenclawUpdateMaintenanceFinished,
  dispatchOpenclawUpdateMaintenanceStarted,
  OPENCLAW_UPDATE_MAINTENANCE_FINISHED,
  OPENCLAW_UPDATE_MAINTENANCE_STARTED,
} from './openclawUpdateLifecycle';
import { CollaborationMaintenanceError } from './collaboration/MaintenanceCoordinator';

test('OpenClaw update maintenance remains active until every caller finishes', () => {
  const originalWindow = globalThis.window;
  const eventWindow = new EventTarget();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: eventWindow,
  });
  let started = 0;
  let finished = 0;
  const onStarted = () => { started += 1; };
  const onFinished = () => { finished += 1; };
  eventWindow.addEventListener(OPENCLAW_UPDATE_MAINTENANCE_STARTED, onStarted);
  eventWindow.addEventListener(OPENCLAW_UPDATE_MAINTENANCE_FINISHED, onFinished);

  try {
    dispatchOpenclawUpdateMaintenanceStarted();
    dispatchOpenclawUpdateMaintenanceStarted();
    assert.deepEqual({ started, finished }, { started: 1, finished: 0 });

    dispatchOpenclawUpdateMaintenanceFinished();
    assert.deepEqual({ started, finished }, { started: 1, finished: 0 });

    dispatchOpenclawUpdateMaintenanceFinished();
    dispatchOpenclawUpdateMaintenanceFinished();
    assert.deepEqual({ started, finished }, { started: 1, finished: 1 });
  } finally {
    eventWindow.removeEventListener(OPENCLAW_UPDATE_MAINTENANCE_STARTED, onStarted);
    eventWindow.removeEventListener(OPENCLAW_UPDATE_MAINTENANCE_FINISHED, onFinished);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('OpenClaw 更新在维护检查前恢复已核验的 Gateway 连接', async () => {
  let connectionId: string | null = null;
  let reconnectCalls = 0;
  let acquireCalls = 0;
  const acquisition = { guarded: false } as Awaited<ReturnType<typeof acquireOpenclawUpdateMaintenance>>;

  const result = await acquireOpenclawUpdateMaintenance({
    captureAttestedConnectionId: () => connectionId,
    reconnectSelectedRuntime: async () => {
      reconnectCalls += 1;
      connectionId = 'connection-2';
      return { success: true };
    },
    acquire: async () => {
      acquireCalls += 1;
      return acquisition;
    },
  });

  assert.equal(result, acquisition);
  assert.equal(reconnectCalls, 1);
  assert.equal(acquireCalls, 1);
});

test('OpenClaw 更新复用仍有效的已核验连接', async () => {
  let reconnectCalls = 0;
  let acquireCalls = 0;
  const acquisition = { guarded: true } as Awaited<ReturnType<typeof acquireOpenclawUpdateMaintenance>>;

  const result = await acquireOpenclawUpdateMaintenance({
    captureAttestedConnectionId: () => 'connection-1',
    reconnectSelectedRuntime: async () => {
      reconnectCalls += 1;
      return { success: true };
    },
    acquire: async () => {
      acquireCalls += 1;
      return acquisition;
    },
  });

  assert.equal(result, acquisition);
  assert.equal(reconnectCalls, 0);
  assert.equal(acquireCalls, 1);
});

test('Gateway 重连未形成已核验连接时 OpenClaw 更新保持阻断', async () => {
  let acquireCalls = 0;

  await assert.rejects(
    acquireOpenclawUpdateMaintenance({
      captureAttestedConnectionId: () => null,
      reconnectSelectedRuntime: async () => ({
        success: false,
        error: 'Gateway identity verification failed',
      }),
      acquire: async () => {
        acquireCalls += 1;
        return { guarded: false } as Awaited<ReturnType<typeof acquireOpenclawUpdateMaintenance>>;
      },
    }),
    (error: unknown) => error instanceof CollaborationMaintenanceError
      && error.code === 'RUNTIME_NOT_READY'
      && /identity verification failed/i.test(error.message),
  );
  assert.equal(acquireCalls, 0);
});
