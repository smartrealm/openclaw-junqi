import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNotificationPreferences } from './notificationPreferences';

test('notification runtime applies all persisted notification gates together', () => {
  const values: Record<string, boolean> = {};
  const target = {
    setEnabled: (enabled: boolean) => { values.enabled = enabled; },
    setSoundEnabled: (enabled: boolean) => { values.soundEnabled = enabled; },
    setDndMode: (enabled: boolean) => { values.dndMode = enabled; },
  };

  applyNotificationPreferences(target, {
    enabled: false,
    soundEnabled: false,
    dndMode: true,
  });

  assert.deepEqual(values, {
    enabled: false,
    soundEnabled: false,
    dndMode: true,
  });
});
