import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLeaf,
  defaultLeaf,
  findLeaf,
  listLeafIds,
  newWorkspace,
  normalizeWorkspace,
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
