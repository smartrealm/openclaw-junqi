import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateBusinessGuidePersistedState } from './businessGuideStore';

test('business guide migrates the legacy dismissed preference without reopening welcome', () => {
  assert.deepEqual(
    migrateBusinessGuidePersistedState({ dismissed: true, tourSeen: true }, 2),
    { welcomeDismissed: true },
  );
  assert.deepEqual(
    migrateBusinessGuidePersistedState({ dismissed: false, tourSeen: true }, 2),
    { welcomeDismissed: true },
  );
});

test('business guide preserves the first-run welcome only for an unseen legacy state', () => {
  assert.deepEqual(
    migrateBusinessGuidePersistedState({ dismissed: false, tourSeen: false }, 2),
    { welcomeDismissed: false },
  );
  assert.deepEqual(
    migrateBusinessGuidePersistedState({ welcomeDismissed: true }, 3),
    { welcomeDismissed: true },
  );
});
