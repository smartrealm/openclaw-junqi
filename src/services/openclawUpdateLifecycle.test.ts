import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchOpenclawUpdateMaintenanceFinished,
  dispatchOpenclawUpdateMaintenanceStarted,
  OPENCLAW_UPDATE_MAINTENANCE_FINISHED,
  OPENCLAW_UPDATE_MAINTENANCE_STARTED,
} from './openclawUpdateLifecycle';

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
