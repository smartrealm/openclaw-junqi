import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gatewayProgress,
  gatewayRestartProgressFromLog,
} from './recoveryProgress';

test('gateway restart progress maps lifecycle phases to stable localized keys', () => {
  assert.deepEqual(
    gatewayRestartProgressFromLog('Stopping desktop-managed gateway process...'),
    {
      step: 'gateway',
      message: 'Restarting OpenClaw Gateway...',
      progress: 0.30,
      key: 'gateway.progress.stoppingManaged',
      status: 'running',
    },
  );

  assert.deepEqual(
    gatewayRestartProgressFromLog('Waiting for Gateway to become reachable...'),
    {
      step: 'gateway',
      message: 'Restarting OpenClaw Gateway...',
      progress: 0.80,
      key: 'gateway.progress.healthCheck',
      status: 'running',
    },
  );

  assert.deepEqual(
    gatewayRestartProgressFromLog('Gateway health check passed.'),
    {
      step: 'gateway',
      message: 'Restarting OpenClaw Gateway...',
      progress: 0.92,
      key: 'gateway.progress.gatewayReady',
      status: 'running',
    },
  );
});

test('gateway restart progress keeps unknown CLI output out of the primary UI copy', () => {
  const detail = gatewayRestartProgressFromLog('third-party launcher: unexpected diagnostic');

  assert.equal(detail.key, 'gateway.progress.restartWorking');
  assert.equal(detail.progress, 0.50);
  assert.doesNotMatch(detail.message, /third-party launcher/);
});

test('runtime readiness carries its interpolation contract without claiming authentication', () => {
  const detail = gatewayProgress.runtimeReady('system-service');

  assert.deepEqual(detail.params, { mode: 'system-service' });
  assert.equal(detail.key, 'gateway.progress.runtimeReady');
  assert.equal(detail.status, 'running');
  assert.match(detail.message, /establishing authenticated connection/i);
  assert.doesNotMatch(detail.message, /authenticated\.$/i);
});

test('process detection and authenticated connection completion stay distinct', () => {
  const detected = gatewayProgress.processDetected();
  const completed = gatewayProgress.recoveryComplete();

  assert.equal(detected.status, 'running');
  assert.equal(detected.progress, 0.72);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress, 1);
  assert.match(completed.message, /authenticated/i);
});
