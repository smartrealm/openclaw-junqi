import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayRestartProgressFromLog } from './recoveryProgress';

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
