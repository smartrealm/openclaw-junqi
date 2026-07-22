import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTerminalLaunchTargets } from './terminalLaunchCatalog';

test('launch catalog keeps Terminal, presets, builtins, and custom commands in one Kooky order', () => {
  const targets = buildTerminalLaunchTargets({
    availableAgentIds: new Set(['codex']),
    agentPreferences: {
      orderedAgentIds: ['codex'],
      hiddenAgentIds: [],
      defaultLauncherId: null,
    },
    presetPreferences: {
      presets: [{ id: 'preset-1', title: 'Repository', path: '/repo' }],
      hiddenPresetIds: [],
    },
    customAgentPreferences: {
      agents: [{ id: 'custom-1', title: 'Aichat', command: 'aichat --fast', baseAgentId: null, env: '' }],
      hiddenAgentIds: [],
    },
    platform: 'posix',
  });

  assert.deepEqual(targets.map((target) => target.id), ['terminal', 'preset-1', 'codex', 'custom-1']);
  assert.deepEqual(targets[3], {
    kind: 'agent', id: 'custom-1', label: 'Aichat', command: 'aichat --fast',
  });
});
