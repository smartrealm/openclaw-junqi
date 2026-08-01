import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentStatusSnapshot } from './agentStatus';

test('agent status uses live usage only for the active session', () => {
  const active = resolveAgentStatusSnapshot({
    session: { key: 'agent:legal:main', label: 'legal', totalTokens: 10, contextTokens: 100 },
    activeSessionKey: 'agent:legal:main',
    activeTokenUsage: { contextTokens: 32, maxTokens: 128, percentage: 25, compactions: 2 },
    activeThinkingLevel: 'high',
    defaultContextTokens: 200_000,
  });

  assert.deepEqual(active, {
    tokenUsage: { contextTokens: 32, maxTokens: 128, percentage: 25, compactions: 2 },
    thinkingLevel: 'high',
  });
});

test('agent status keeps an inactive agent scoped to its own cached session metadata', () => {
  const inactive = resolveAgentStatusSnapshot({
    session: {
      key: 'agent:novelsmith:main',
      label: 'novelsmith',
      totalTokens: 3_000,
      contextTokens: 8_000,
      compactionCount: 1,
      thinkingLevel: 'auto',
    },
    activeSessionKey: 'agent:legal:main',
    activeTokenUsage: { contextTokens: 32, maxTokens: 128, percentage: 25, compactions: 2 },
    activeThinkingLevel: 'high',
    defaultContextTokens: 200_000,
  });

  assert.deepEqual(inactive, {
    tokenUsage: { contextTokens: 3_000, maxTokens: 8_000, percentage: 38, compactions: 1 },
    thinkingLevel: 'auto',
  });
});

test('agent status does not invent a context limit when Gateway omitted it', () => {
  const unknown = resolveAgentStatusSnapshot({
    session: { key: 'agent:legal:main', label: 'legal' },
    activeSessionKey: 'agent:main:main',
    activeTokenUsage: null,
    activeThinkingLevel: 'high',
    defaultContextTokens: null,
  });

  assert.deepEqual(unknown, { tokenUsage: null, thinkingLevel: null });
});
