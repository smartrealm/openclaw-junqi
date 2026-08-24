import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_GUIDE_STEPS,
  CHANNEL_GUIDE_STEPS,
  FIRST_RESPONSE_GUIDE_STEPS,
} from './steps';

test('first-response guide follows real configuration and conversation boundaries', () => {
  assert.deepEqual(
    FIRST_RESPONSE_GUIDE_STEPS.map((step) => [step.id, step.completion.kind]),
    [
      ['configure-model-provider', 'target-click'],
      ['choose-model-provider', 'selector-appears'],
      ['save-model-provider', 'config-saved'],
      ['new-session', 'target-click'],
      ['create-session', 'session-created'],
      ['send-first-message', 'user-message'],
      ['wait-first-response', 'assistant-response'],
    ],
  );
});

test('guide selectors stay on explicit operation anchors', () => {
  const steps = [...FIRST_RESPONSE_GUIDE_STEPS, ...CHANNEL_GUIDE_STEPS, ...AGENT_GUIDE_STEPS];
  for (const step of steps) {
    assert.match(step.selector, /^\[data-tour="[a-z-]+"\]$/);
  }
});

test('channels and agents remain independent extension guides', () => {
  assert.deepEqual(CHANNEL_GUIDE_STEPS.map((step) => step.id), ['configure-channel']);
  assert.deepEqual(AGENT_GUIDE_STEPS.map((step) => step.id), ['manage-agents']);
});
