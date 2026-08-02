import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCronAgentOptions,
  resolveCronAgentAvailability,
} from './cronAgentSelection';

test('cron Agent availability distinguishes loading, failure, empty, and ready data', () => {
  assert.equal(resolveCronAgentAvailability(true, null, []), 'loading');
  assert.equal(resolveCronAgentAvailability(false, 'offline', []), 'error');
  assert.equal(resolveCronAgentAvailability(false, null, []), 'empty');
  assert.equal(resolveCronAgentAvailability(false, null, [{ id: 'main' }]), 'ready');
});

test('cron Agent options retain an unavailable selected Agent without duplicating live Agents', () => {
  assert.deepEqual(buildCronAgentOptions([{ id: 'writer', name: 'Writer' }], 'retired'), [
    { id: 'retired', label: 'retired', unavailable: true },
    { id: 'writer', label: 'Writer', unavailable: false },
  ]);
  assert.deepEqual(buildCronAgentOptions([{ id: 'writer', name: 'Writer' }], 'writer'), [
    { id: 'writer', label: 'Writer', unavailable: false },
  ]);
});
