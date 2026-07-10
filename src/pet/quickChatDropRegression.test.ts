import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('main-window and pet-window drops share one QuickChat coordinator', async () => {
  const [lib, pet, quickchat] = await Promise.all([
    read('../../src-tauri/src/lib.rs'),
    read('../../src-tauri/src/commands/pet.rs'),
    read('../../src-tauri/src/commands/quickchat.rs'),
  ]);
  assert.match(lib, /DragDropEvent::Drop[\s\S]*ResourceDropCoordinator::drop/);
  assert.match(pet, /DragDropEvent::Drop[\s\S]*ResourceDropCoordinator::drop/);
  assert.match(quickchat, /pub struct ResourceDropCoordinator/);
  assert.match(quickchat, /pub fn drop[\s\S]*spawn_quickchat_for_paths/);
});

test('drop runtime no longer redirects the main window to a full chat', async () => {
  const runtime = await read('../runtime/DragDropRuntime.tsx');
  assert.doesNotMatch(runtime, /history\.replaceState/);
  assert.doesNotMatch(runtime, /setActiveSession/);
});

test('QuickChat recovers seed paths even if the startup event was missed', async () => {
  const [page, backend] = await Promise.all([
    read('../pages/QuickChatPage.tsx'),
    read('../../src-tauri/src/commands/quickchat.rs'),
  ]);
  assert.match(page, /get_quickchat_seed/);
  assert.match(backend, /static QUICKCHAT_SEED/);
});

test('QuickChat has a connection-only root and cannot own Gateway lifecycle', async () => {
  const [entry, root, lease] = await Promise.all([
    read('../main.tsx'),
    read('../pages/QuickChatRoot.tsx'),
    read('../services/gateway/GatewayClientLease.ts'),
  ]);
  assert.match(entry, /windowLabel === 'quickchat'/);
  assert.match(root, /GatewayClientLease/);
  assert.doesNotMatch(root, /gatewayManager|ensureRunning|executeStart|restartGateway/);
  assert.match(lease, /resolveConnectionTarget/);
  assert.doesNotMatch(lease, /executeStart\(|restartGateway\(|ensureRunning\(/);
});

test('new pet and QuickChat strings exist in both visible languages', async () => {
  const [zh, en] = await Promise.all([
    read('../locales/zh.json').then(JSON.parse),
    read('../locales/en.json').then(JSON.parse),
  ]);
  const paths = [
    ['pet', 'settings', 'animatedTitle'],
    ['pet', 'settings', 'createWithCodex'],
    ['pet', 'quickChat', 'dropTitle'],
    ['pet', 'quickChat', 'defaultQuestionSingle'],
    ['pet', 'quickChat', 'questionPlaceholder'],
    ['pet', 'quickChat', 'send'],
  ];
  for (const path of paths) {
    const resolve = (root: any) => path.reduce((value, key) => value?.[key], root);
    assert.equal(typeof resolve(zh), 'string', `missing zh ${path.join('.')}`);
    assert.equal(typeof resolve(en), 'string', `missing en ${path.join('.')}`);
  }
});
