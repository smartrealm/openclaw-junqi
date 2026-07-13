import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPlanModePrompt } from './agentPrompt';

test('plan mode instruction is appended exactly once', () => {
  assert.equal(applyPlanModePrompt('Inspect the project', true), 'Inspect the project\n\nPlease use plan mode.');
  assert.equal(
    applyPlanModePrompt('Inspect the project\n\nPlease use plan mode.  ', true),
    'Inspect the project\n\nPlease use plan mode.',
  );
});

test('normal prompts are only trimmed', () => {
  assert.equal(applyPlanModePrompt('  Inspect the project  ', false), 'Inspect the project');
  assert.equal(applyPlanModePrompt('   ', true), '');
});
