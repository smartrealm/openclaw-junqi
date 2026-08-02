import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateBusinessGuidePersistedState, useBusinessGuideStore } from './businessGuideStore';

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

test('business guide welcome does not reopen after dismissal', () => {
  useBusinessGuideStore.setState({ welcomeDismissed: false, tourOpen: false });

  useBusinessGuideStore.getState().dismissWelcome();

  assert.equal(useBusinessGuideStore.getState().welcomeDismissed, true);
  assert.equal(useBusinessGuideStore.getState().tourOpen, false);
});

test('business guide tour opens only from the explicit global trigger', () => {
  useBusinessGuideStore.setState({ welcomeDismissed: true, tourOpen: false });

  useBusinessGuideStore.getState().openTour();
  assert.equal(useBusinessGuideStore.getState().tourOpen, true);

  useBusinessGuideStore.getState().closeTour();
  assert.equal(useBusinessGuideStore.getState().tourOpen, false);
  assert.equal(useBusinessGuideStore.getState().welcomeDismissed, true);
});
