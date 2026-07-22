import assert from 'node:assert/strict';
import test from 'node:test';
import type { Workspace } from '@/workspace/types';
import {
  buildTerminalPaletteItems,
  matchTerminalPaletteItems,
} from './terminalCommandPalette';

const workspaces: Workspace[] = [
  {
    id: 'source',
    name: 'JunQi',
    projectDirectory: '/repo/junqi',
    workingDirectory: '/repo/junqi',
    root: { type: 'leaf', id: 'pane-source', config: { kind: 'shell', cwd: '/repo/junqi' } },
    focusedPaneId: 'pane-source',
  },
  {
    id: 'worktree',
    name: 'terminal-parity',
    projectDirectory: '/repo/junqi',
    workingDirectory: '/repo/junqi-terminal-parity',
    root: { type: 'leaf', id: 'pane-worktree', config: { kind: 'shell', cwd: '/repo/junqi-terminal-parity' } },
    focusedPaneId: 'pane-worktree',
    worktreeParentId: 'source',
    worktreeBranch: 'feature/terminal-parity',
    worktreePath: '/repo/junqi-terminal-parity',
  },
];

test('terminal palette indexes live workspaces, tabs, worktrees, agents, SSH, and recent folders', () => {
  const items = buildTerminalPaletteItems({
    workspaces,
    sessions: [{
      shellId: 'shell-1', paneId: 'pane-source', workspaceId: 'source', title: 'API', projectPath: '/repo/junqi', agent: 'claude', updatedAt: 1, focus: () => {},
    }],
    launchTargets: [
      { kind: 'terminal', id: 'terminal', label: 'Terminal' },
      { kind: 'preset', id: 'preset-1', label: 'Repository', path: '/repo/junqi' },
      { kind: 'agent', id: 'codex', label: 'Codex', command: 'codex', iconAgent: 'codex' },
      { kind: 'agent', id: 'pi', label: 'Pi', command: 'pi', iconAgent: 'pi' },
    ],
    recentDirectories: [{ name: 'other', path: '/repo/other' }],
    worktreeWorkspaceIds: new Set(['source']),
    workspaceDefaultLabel: 'Workspace',
  });

  assert.deepEqual(items.map((item) => item.id), [
    'workspace:source',
    'worktree:source',
    'tab:shell-1',
    'workspace:worktree',
    'terminal',
    'preset:preset-1',
    'agent:codex',
    'agent:pi',
    'ssh',
    'recent:/repo/other',
  ]);
  assert.equal(matchTerminalPaletteItems('api', items)[0]?.id, 'tab:shell-1');
  assert.deepEqual(items.find((item) => item.id === 'tab:shell-1'), {
    id: 'tab:shell-1', title: 'API', subtitle: 'tab in JunQi', kind: 'tab', shellId: 'shell-1', iconAgent: 'claude',
  });
  assert.equal(items.some((item) => item.id === 'agent:droid'), false);
});
