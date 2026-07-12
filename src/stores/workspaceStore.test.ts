import assert from 'node:assert/strict';
import test from 'node:test';
import { findLeaf, listLeafIds, newWorkspace } from '@/workspace/types';
import { useWorkspaceStore } from './workspaceStore';

function resetStore(workingDirectory = '/repo') {
  const workspace = newWorkspace('Project', workingDirectory);
  useWorkspaceStore.setState({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    defaultWorkingDirectory: workingDirectory,
  });
  return workspace;
}

test('split inherits the focused pane cwd and focuses the actual new leaf', () => {
  const workspace = resetStore('/repo');
  const source = workspace.root;
  assert.equal(source.type, 'leaf');
  if (source.type !== 'leaf') return;

  useWorkspaceStore.getState().setPaneCwd(source.id, '/repo/packages/api');
  const newPaneId = useWorkspaceStore.getState().splitPane(source.id, 'horizontal');
  const next = useWorkspaceStore.getState().workspaces[0];

  assert.ok(newPaneId);
  assert.equal(next.focusedPaneId, newPaneId);
  assert.ok(findLeaf(next.root, newPaneId!));
  assert.equal(findLeaf(next.root, newPaneId!)?.config.cwd, '/repo/packages/api');
  assert.equal(next.projectDirectory, '/repo');
});

test('closing a focused nested pane chooses an existing nearest pane', () => {
  const workspace = resetStore('/repo');
  const source = workspace.root;
  assert.equal(source.type, 'leaf');
  if (source.type !== 'leaf') return;

  const firstNew = useWorkspaceStore.getState().splitPane(source.id, 'horizontal');
  assert.ok(firstNew);
  const secondNew = useWorkspaceStore.getState().splitPane(firstNew!, 'vertical');
  assert.ok(secondNew);
  useWorkspaceStore.getState().closePane(secondNew!);

  const next = useWorkspaceStore.getState().workspaces[0];
  const leafIds = listLeafIds(next.root);
  assert.ok(leafIds.includes(next.focusedPaneId));
  assert.equal(leafIds.includes(secondNew!), false);
});

test('new workspaces inherit the active pane cwd instead of the original project root', () => {
  const workspace = resetStore('/repo');
  const source = workspace.root;
  assert.equal(source.type, 'leaf');
  if (source.type !== 'leaf') return;

  useWorkspaceStore.getState().setPaneCwd(source.id, '/repo/packages/web');
  const created = useWorkspaceStore.getState().createWorkspace('Web work');

  assert.equal(created.workingDirectory, '/repo/packages/web');
  assert.equal(created.projectDirectory, '/repo/packages/web');
  assert.equal(findLeaf(created.root, created.focusedPaneId)?.config.cwd, '/repo/packages/web');
});

test('background workspace cwd updates stay isolated from the active workspace', () => {
  const background = resetStore('/repo-a');
  const backgroundLeafId = background.focusedPaneId;
  const active = useWorkspaceStore.getState().createWorkspace('Project B', '/repo-b');

  useWorkspaceStore.getState().setPaneCwd(
    backgroundLeafId,
    '/repo-a/packages/worker',
    background.id,
  );

  const state = useWorkspaceStore.getState();
  const updatedBackground = state.workspaces.find((workspace) => workspace.id === background.id);
  const unchangedActive = state.workspaces.find((workspace) => workspace.id === active.id);
  assert.equal(state.activeWorkspaceId, active.id);
  assert.equal(updatedBackground?.workingDirectory, '/repo-a/packages/worker');
  assert.equal(findLeaf(updatedBackground!.root, backgroundLeafId)?.config.cwd, '/repo-a/packages/worker');
  assert.equal(unchangedActive?.workingDirectory, '/repo-b');
  assert.equal(updatedBackground?.projectDirectory, '/repo-a');
  assert.equal(unchangedActive?.projectDirectory, '/repo-b');
  assert.equal(findLeaf(unchangedActive!.root, active.focusedPaneId)?.config.cwd, '/repo-b');
});

test('moving a source workspace keeps its worktree children adjacent', () => {
  const first = resetStore('/repo-a');
  const second = useWorkspaceStore.getState().createWorkspace('Project B', '/repo-b');
  const worktree = useWorkspaceStore.getState().createWorkspace('Task', '/repo-a-task');
  useWorkspaceStore.setState((state) => ({
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === worktree.id
        ? {
          ...workspace,
          worktreeParentId: first.id,
          worktreeBranch: 'feature/task',
          worktreePath: '/repo-a-task',
        }
        : workspace
    )),
  }));

  useWorkspaceStore.getState().moveWorkspace(first.id, second.id);
  const ids = useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id);
  assert.deepEqual(ids, [first.id, worktree.id, second.id]);

  useWorkspaceStore.getState().moveWorkspace(worktree.id, second.id);
  assert.deepEqual(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id), ids);

  useWorkspaceStore.getState().moveWorkspace(first.id, second.id, 'after');
  assert.deepEqual(
    useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id),
    [second.id, first.id, worktree.id],
  );
});

test('workspace family operations never leave a worktree orphaned', () => {
  const source = resetStore('/repo-a');
  const worktree = useWorkspaceStore.getState().createWorkspace('Task', '/repo-a-task');
  const other = useWorkspaceStore.getState().createWorkspace('Project B', '/repo-b');
  useWorkspaceStore.setState((state) => ({
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === worktree.id ? { ...workspace, worktreeParentId: source.id } : workspace
    )),
  }));

  useWorkspaceStore.getState().closeOtherWorkspaces(worktree.id);
  assert.deepEqual(
    useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id).sort(),
    [source.id, worktree.id].sort(),
  );

  useWorkspaceStore.getState().closeWorkspace(source.id);
  const remaining = useWorkspaceStore.getState().workspaces;
  assert.equal(remaining.some((workspace) => workspace.worktreeParentId === source.id), false);
  assert.equal(remaining.some((workspace) => workspace.id === other.id), false);
});

test('created worktrees stay beside their source and retain source project ownership', () => {
  const source = resetStore('/repo-a');
  const other = useWorkspaceStore.getState().createWorkspace('Project B', '/repo-b');

  const worktree = useWorkspaceStore.getState().createWorktreeWorkspace(
    source.id,
    'feature/terminal-parity',
    '/repo-a-feature-terminal-parity',
  );

  assert.ok(worktree);
  assert.equal(worktree?.projectDirectory, '/repo-a');
  assert.equal(worktree?.worktreeParentId, source.id);
  assert.equal(worktree?.worktreeBranch, 'feature/terminal-parity');
  assert.deepEqual(
    useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id),
    [source.id, worktree!.id, other.id],
  );
  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, worktree?.id);
});

test('SSH workspaces do not inherit the active local cwd when they split', () => {
  resetStore('/repo-a');
  const remote = useWorkspaceStore.getState().createSshWorkspace('dev@bastion');
  assert.ok(remote);
  const pane = useWorkspaceStore.getState().splitPane(remote!.focusedPaneId, 'horizontal', undefined, remote!.id);
  const current = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.id === remote!.id)!;

  assert.equal(current.sshRemoteHost, 'dev@bastion');
  assert.equal(findLeaf(current.root, pane!)?.config.cwd, undefined);
});

test('SSH workspaces discard stale local cwd values when activated', () => {
  resetStore('/repo-a');
  const remote = useWorkspaceStore.getState().createSshWorkspace('dev@bastion');
  assert.ok(remote);

  useWorkspaceStore.getState().updateLeafConfig(remote!.focusedPaneId, { cwd: '/accidental-local-path' }, remote!.id);

  const current = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.id === remote!.id)!;
  assert.equal(current.workingDirectory, '');
  assert.equal(current.projectDirectory, '');
  assert.equal(findLeaf(current.root, current.focusedPaneId)?.config.cwd, undefined);
});
