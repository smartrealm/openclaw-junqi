import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAssistantPresentation } from './assistantPresentation';

test('assistant presentation uses the Gateway-resolved identity when available', () => {
  const presentation = resolveAssistantPresentation({
    agentId: 'research',
    name: 'Research Assistant',
    emoji: 'mark',
  }, 'Assistant');

  assert.deepEqual(presentation, {
    name: 'Research Assistant',
    letter: 'R',
    marker: 'mark',
  });
});

test('assistant presentation never derives an identity from a session key or agent catalog', () => {
  const presentation = resolveAssistantPresentation(null, 'Assistant');

  assert.deepEqual(presentation, {
    name: 'Assistant',
    letter: 'A',
  });
});
