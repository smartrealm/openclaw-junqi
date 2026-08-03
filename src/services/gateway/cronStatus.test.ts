import assert from 'node:assert/strict';
import test from 'node:test';
import { getCronStatus, parseCronStatus } from './cronStatus';

const validStatus = {
  enabled: true,
  storePath: '/runtime/state/cron.sqlite',
  storage: 'sqlite',
  sqlitePath: '/runtime/state/cron.sqlite',
  jobs: 3,
  nextWakeAtMs: 1785753000000,
};

test('decodes the complete OpenClaw cron status summary without exposing paths to callers', () => {
  assert.deepEqual(parseCronStatus(validStatus), validStatus);
});

test('fails closed on missing storage fields, unsupported storage, and invalid wake times', () => {
  assert.throws(() => parseCronStatus({ ...validStatus, sqlitePath: undefined }));
  assert.throws(() => parseCronStatus({ ...validStatus, storage: 'json' }));
  assert.throws(() => parseCronStatus({ ...validStatus, nextWakeAtMs: -1 }));
  assert.throws(() => parseCronStatus({ ...validStatus, jobs: 1.5 }));
});

test('uses the exact empty params envelope for the cron.status RPC', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const status = await getCronStatus(async (method, params) => {
    calls.push({ method, params });
    return validStatus;
  });
  assert.deepEqual(status, validStatus);
  assert.deepEqual(calls, [{ method: 'cron.status', params: {} }]);
});
