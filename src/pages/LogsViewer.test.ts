import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionUsageLogSelection } from './LogsViewer';

test('session usage logs select the actual active session without manufacturing a main session', () => {
  const selection = resolveSessionUsageLogSelection('agent:alpha:active', [
    { key: 'agent:beta:other', label: 'Other session' },
  ]);

  assert.equal(selection.preferredKey, 'agent:alpha:active');
  assert.deepEqual(selection.options, [
    { key: 'agent:alpha:active', label: 'agent:alpha:active' },
    { key: 'agent:beta:other', label: 'Other session' },
  ]);
});

test('session usage logs use the Gateway session list only when there is no active session', () => {
  const selection = resolveSessionUsageLogSelection(null, [
    { key: '', label: 'Ignore blank key' },
    { key: 'agent:beta:other', label: 'Other session' },
  ]);

  assert.equal(selection.preferredKey, 'agent:beta:other');
  assert.deepEqual(selection.options, [{ key: 'agent:beta:other', label: 'Other session' }]);
});
