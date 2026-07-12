import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLeaf,
  defaultLeaf,
  findLeaf,
  listLeafIds,
  newWorkspace,
  newSshWorkspace,
  normalizeWorkspace,
  normalizeWorkspaces,
  removeLeaf,
  splitLeaf,
} from './types';

test('nested splits preserve one stable id per leaf and focusable ids remain resolvable', () => {
  const workspace = newWorkspace('Project', '/repo');
  const first = workspace.root;
  assert.equal(first.type, 'leaf');
  if (first.type !== 'leaf') return;

  const second = createLeaf({ kind: 'shell', cwd: '/repo/packages/api' }, 'pane-second');
  const firstSplit = splitLeaf(first, first.id, 'horizontal', second);
  const third = createLeaf({ kind: 'agent', agent: 'codex', cwd: '/repo/packages/web' }, 'pane-third');
  const nested = splitLeaf(firstSplit, second.id, 'vertical', third);

  assert.deepEqual(listLeafIds(nested), [first.id, second.id, third.id]);
  for (const id of listLeafIds(nested)) {
    assert.equal(findLeaf(nested, id)?.id, id);
  }
  assert.equal(findLeaf(nested, second.id)?.config.cwd, '/repo/packages/api');
  assert.equal(findLeaf(nested, third.id)?.config.agent, 'codex');
});

test('removing a nested focused leaf collapses only its parent and leaves a real sibling target', () => {
  const first = defaultLeaf('shell', undefined, '/repo');
  const second = createLeaf({ kind: 'shell', cwd: '/repo/a' }, 'pane-a');
  const third = createLeaf({ kind: 'shell', cwd: '/repo/b' }, 'pane-b');
  const root = splitLeaf(
    splitLeaf(first, first.id, 'horizontal', second),
    second.id,
    'vertical',
    third,
  );

  const collapsed = removeLeaf(root, third.id);
  assert.ok(collapsed);
  assert.deepEqual(listLeafIds(collapsed!), [first.id, second.id]);
  assert.ok(findLeaf(collapsed!, second.id));
  assert.equal(findLeaf(collapsed!, root.id), null);
});

test('normalization migrates legacy projectPath data and repairs invalid focus ids', () => {
  const migrated = normalizeWorkspace({
    id: 'workspace-one',
    name: ' Legacy project ',
    focusedPaneId: 'legacy-config-id',
    root: {
      type: 'split',
      id: 'split-one',
      direction: 'horizontal',
      sizes: [0.9, 0.1],
      children: [
        {
          type: 'leaf',
          id: 'pane-one',
          config: { id: 'legacy-config-id', kind: 'shell', projectPath: '/repo' },
        },
        {
          type: 'leaf',
          id: 'pane-two',
          config: { id: 'another-legacy-id', kind: 'agent', agent: 'codex', projectPath: '/repo/app' },
        },
      ],
    },
  });

  assert.equal(migrated.name, 'Legacy project');
  assert.equal(migrated.workingDirectory, '/repo');
  assert.equal(migrated.projectDirectory, '/repo');
  assert.deepEqual(listLeafIds(migrated.root), ['pane-one', 'pane-two']);
  assert.equal(migrated.focusedPaneId, 'pane-one');
  assert.deepEqual(findLeaf(migrated.root, 'pane-one')?.config, {
    kind: 'shell',
    cwd: '/repo',
  });
  assert.deepEqual(findLeaf(migrated.root, 'pane-two')?.config, {
    kind: 'agent',
    agent: 'codex',
    cwd: '/repo/app',
  });
});

test('normalization infers a missing workspace cwd from the focused pane', () => {
  const migrated = normalizeWorkspace({
    id: 'workspace-focused-cwd',
    name: 'Focused project',
    focusedPaneId: 'pane-two',
    root: {
      type: 'split',
      id: 'split-one',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'leaf',
          id: 'pane-one',
          config: { kind: 'shell', cwd: '/repo' },
        },
        {
          type: 'leaf',
          id: 'pane-two',
          config: { kind: 'shell', cwd: '/repo/packages/web' },
        },
      ],
    },
  });

  assert.equal(migrated.focusedPaneId, 'pane-two');
  assert.equal(migrated.workingDirectory, '/repo/packages/web');
  assert.equal(migrated.projectDirectory, '/repo/packages/web');
});

test('normalization maps a legacy config focus id to the matching non-first pane', () => {
  const migrated = normalizeWorkspace({
    focusedPaneId: 'legacy-second',
    root: {
      type: 'split',
      id: 'split-legacy',
      children: [
        { type: 'leaf', id: 'pane-one', config: { id: 'legacy-first', cwd: '/repo' } },
        { type: 'leaf', id: 'pane-two', config: { id: 'legacy-second', cwd: '/repo/app' } },
      ],
    },
  });

  assert.equal(migrated.focusedPaneId, 'pane-two');
  assert.equal(migrated.workingDirectory, '/repo/app');
  assert.equal(migrated.projectDirectory, '/repo/app');
});

test('workspace collection normalization de-duplicates pane ids globally', () => {
  const workspaces = normalizeWorkspaces([
    {
      id: 'workspace-one',
      focusedPaneId: 'shared-pane',
      root: { type: 'leaf', id: 'shared-pane', config: { cwd: '/repo/one' } },
    },
    {
      id: 'workspace-two',
      focusedPaneId: 'shared-pane',
      root: { type: 'leaf', id: 'shared-pane', config: { cwd: '/repo/two' } },
    },
  ]);

  const firstPaneId = listLeafIds(workspaces[0].root)[0];
  const secondPaneId = listLeafIds(workspaces[1].root)[0];
  assert.equal(firstPaneId, 'shared-pane');
  assert.notEqual(secondPaneId, firstPaneId);
  assert.equal(workspaces[1].focusedPaneId, secondPaneId);
  assert.equal(workspaces[1].workingDirectory, '/repo/two');
  assert.equal(workspaces[1].projectDirectory, '/repo/two');
});

test('normalization preserves a stable project root when focused cwd changes', () => {
  const migrated = normalizeWorkspace({
    id: 'workspace-one',
    projectDirectory: '/repo',
    workingDirectory: '/repo/packages/web',
    focusedPaneId: 'pane-one',
    root: { type: 'leaf', id: 'pane-one', config: { cwd: '/repo/packages/web' } },
  });

  assert.equal(migrated.projectDirectory, '/repo');
  assert.equal(migrated.workingDirectory, '/repo/packages/web');
});

test('normalization retains worktree ownership separately from the active cwd', () => {
  const migrated = normalizeWorkspace({
    id: 'worktree',
    projectDirectory: '/repo-task',
    workingDirectory: '/tmp',
    worktreeParentId: 'source',
    worktreeBranch: 'feature/task',
    worktreePath: '/repo-task',
    root: { type: 'leaf', id: 'pane-one', config: { cwd: '/tmp' } },
  });

  assert.equal(migrated.worktreeParentId, 'source');
  assert.equal(migrated.worktreeBranch, 'feature/task');
  assert.equal(migrated.worktreePath, '/repo-task');
  assert.equal(migrated.workingDirectory, '/tmp');
});

test('workspace path fields preserve legal leading and trailing whitespace', () => {
  const workspace = newWorkspace('Report', '/projects/report ');

  assert.equal(workspace.projectDirectory, '/projects/report ');
  assert.equal(workspace.workingDirectory, '/projects/report ');
  assert.equal(findLeaf(workspace.root, workspace.focusedPaneId)?.config.cwd, '/projects/report ');
});

test('SSH workspaces persist a remote destination without inventing a local root', () => {
  const workspace = newSshWorkspace('dev@bastion');
  assert.equal(workspace.sshRemoteHost, 'dev@bastion');
  assert.equal(workspace.projectDirectory, '');
  assert.equal(workspace.workingDirectory, '');

  const restored = normalizeWorkspace({
    ...workspace,
    root: workspace.root,
  });
  assert.equal(restored.sshRemoteHost, 'dev@bastion');
  assert.equal(restored.projectDirectory, '');

  const stale = normalizeWorkspace({
    ...workspace,
    projectDirectory: '/old-local-project',
    workingDirectory: '/old-local-cwd',
    root: createLeaf({ kind: 'shell', cwd: '/old-local-pane' }, workspace.focusedPaneId),
  });
  assert.equal(stale.projectDirectory, '');
  assert.equal(stale.workingDirectory, '');
  assert.equal(findLeaf(stale.root, stale.focusedPaneId)?.config.cwd, undefined);
});
