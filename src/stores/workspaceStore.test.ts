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
  assert.equal(findLeaf(created.root, created.focusedPaneId)?.config.cwd, '/repo/packages/web');
});
