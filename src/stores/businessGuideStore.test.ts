import assert from 'node:assert/strict';
import test from 'node:test';
import { useBusinessGuideStore } from './businessGuideStore';

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
