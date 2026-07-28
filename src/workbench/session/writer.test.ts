import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkbenchSessionSnapshot } from './schema';
import { WORKBENCH_SESSION_SCHEMA_VERSION } from './schema';
import { WorkbenchSessionWriter } from './writer';

function snapshot(panel: WorkbenchSessionSnapshot['rightSidebarPanel']): WorkbenchSessionSnapshot {
  return {
    schemaVersion: WORKBENCH_SESSION_SCHEMA_VERSION,
    activeWorktreeId: null,
    worktrees: {},
    activeGroupId: 'main',
    layout: { type: 'group', groupId: 'main' },
    groups: { main: { id: 'main', tabIds: [], activeTabId: null } },
    tabs: {}, sidebarMode: 'full', rightSidebarPanel: panel, rightSidebarCollapsed: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('writer blocks pre-hydration writes', async () => {
  const writer = new WorkbenchSessionWriter('local', { save: async () => ({ generation: 1, payloadHash: 'x', unchanged: false }) });
  await assert.rejects(writer.schedule(snapshot('files')), /not hydrated/);
});

test('writer serializes generations and coalesces pending snapshots', async () => {
  const first = deferred<{ generation: number; payloadHash: string; unchanged: boolean }>();
  const calls: Array<{ generation: number; panel: string }> = [];
  const writer = new WorkbenchSessionWriter('local', {
    save: async (_partition, generation, value) => {
      calls.push({ generation, panel: value.rightSidebarPanel });
      return calls.length === 1 ? first.promise : { generation: generation + 1, payloadHash: 'next', unchanged: false };
    },
  });
  writer.enable(4);
  const firstWrite = writer.schedule(snapshot('files'));
  await Promise.resolve();
  assert.deepEqual(calls, [{ generation: 4, panel: 'files' }]);
  const secondWrite = writer.schedule(snapshot('search'));
  const thirdWrite = writer.schedule(snapshot('vault'));
  first.resolve({ generation: 5, payloadHash: 'first', unchanged: false });
  await Promise.all([firstWrite, secondWrite, thirdWrite]);
  assert.deepEqual(calls, [
    { generation: 4, panel: 'files' },
    { generation: 5, panel: 'vault' },
  ]);
});
