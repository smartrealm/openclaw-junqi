import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { executionProcessActivity } from './ExecutionProcessGroup';

const thinkingSource = readFileSync(new URL('./ThinkingBubble.tsx', import.meta.url), 'utf8');
const executionSource = readFileSync(new URL('./ExecutionProcessGroup.tsx', import.meta.url), 'utf8');

test('live reasoning uses one semantic agent activity glyph instead of duplicate loop animations', () => {
  assert.match(thinkingSource, /<AgentActivityIndicator[\s\S]*activity="thinking"[\s\S]*decorative/);
  assert.doesNotMatch(thinkingSource, /<LoadingIndicator/);
  assert.doesNotMatch(thinkingSource, /animationDelay/);
});

test('execution summary distinguishes thinking from verified running tool activity', () => {
  assert.equal(executionProcessActivity(0), 'thinking');
  assert.equal(executionProcessActivity(1), 'working');
  assert.equal(executionProcessActivity(3), 'working');
  assert.doesNotMatch(executionSource, /<LoadingIndicator/);
});
