import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { hideDynamicIsland } from './DynamicIslandActions';
import { resolveDynamicIslandAgentActivity } from './model';

const islandSource = readFileSync(new URL('./DynamicIsland.tsx', import.meta.url), 'utf8');

test('Dynamic Island close hides natively and returns its intent to the main-window owner', async () => {
  const calls: string[] = [];
  await hideDynamicIsland(
    async () => { calls.push('native-hide'); },
    async (action) => { calls.push(action.type); },
  );
  assert.deepEqual(calls.sort(), ['hide', 'native-hide']);
});

test('Dynamic Island close keeps the main-window intent when native hiding fails', async () => {
  const calls: string[] = [];
  await assert.rejects(
    hideDynamicIsland(
      async () => { throw new Error('native hide failed'); },
      async (action) => { calls.push(action.type); },
    ),
    /native hide failed/,
  );
  assert.deepEqual(calls, ['hide']);
});

test('Dynamic Island maps only projected activity phases and removes duplicate running spinners', () => {
  const base = {
    voicePhase: 'idle' as const,
    voiceInput: { mode: 'off' as const, phase: 'off' as const, error: null },
    runningTaskCount: 0,
  };
  assert.equal(resolveDynamicIslandAgentActivity({ ...base, sessionPhase: 'thinking' }), 'thinking');
  assert.equal(resolveDynamicIslandAgentActivity({ ...base, sessionPhase: 'generating' }), 'generating');
  assert.equal(resolveDynamicIslandAgentActivity({ ...base, sessionPhase: 'observing' }), 'working');
  assert.equal(resolveDynamicIslandAgentActivity({ ...base, runningTaskCount: 2 }), 'working');
  assert.equal(resolveDynamicIslandAgentActivity({ ...base, voicePhase: 'listening' }), 'listening');
  assert.equal(resolveDynamicIslandAgentActivity({ ...base, voicePhase: 'speaking' }), 'generating');
  assert.equal(resolveDynamicIslandAgentActivity({
    ...base,
    voiceInput: { mode: 'talk', phase: 'thinking', error: null },
  }), 'thinking');
  assert.equal(resolveDynamicIslandAgentActivity(base), null);
  assert.match(islandSource, /<AgentActivityIndicator/);
  assert.doesNotMatch(islandSource, /junqi-island-spinner/);
});
