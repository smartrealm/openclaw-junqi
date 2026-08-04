import assert from 'node:assert/strict';
import test from 'node:test';
import { JarvisVoiceSettingsOperationGate } from './JarvisVoiceSettingsOperationGate';

test('后发刷新使旧刷新失去提交资格', () => {
  const gate = new JarvisVoiceSettingsOperationGate();
  const older = gate.beginRefresh();
  const newer = gate.beginRefresh();

  assert.equal(gate.isLatest(older), false);
  assert.equal(gate.canCommit(older), false);
  assert.equal(gate.canCommit(newer), true);
});

test('事件或写入确认使在途刷新失去提交资格', () => {
  const gate = new JarvisVoiceSettingsOperationGate();
  const refresh = gate.beginRefresh();

  gate.invalidateData();

  assert.equal(gate.isLatest(refresh), true);
  assert.equal(gate.canCommit(refresh), false);
});
