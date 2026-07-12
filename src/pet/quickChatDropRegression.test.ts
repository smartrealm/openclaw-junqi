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
    ['pet', 'settings', 'createInChat'],
    ['pet', 'settings', 'preparingBuiltinSkill'],
    ['pet', 'settings', 'builtinSkillError'],
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

test('pet creation installs the JunQi-bundled skill into the current chat workspace', async () => {
  const [settings, tauriConfig, backend, skill] = await Promise.all([
    read('../pages/SettingsPage.tsx'),
    read('../../src-tauri/tauri.conf.json').then(JSON.parse),
    read('../../src-tauri/src/commands/builtin_skills.rs'),
    read('../../src-tauri/resources/skills/hatch-pet/SKILL.md'),
  ]);
  assert.match(settings, /install_builtin_skill_for_chat/);
  assert.match(settings, /@hatch-pet/);
  assert.doesNotMatch(settings, /agent-run\?\$\{params/);
  assert.equal(
    tauriConfig.bundle.resources['resources/skills/hatch-pet'],
    'skills/hatch-pet',
  );
  assert.match(backend, /HATCH_PET_REQUIRED_FILES/);
  assert.match(backend, /install_into_workspace/);
  assert.match(skill, /## JunQi Deployment/);
});

test('pet generation promotes only a validated, newly-created v2 package', async () => {
  const [settings, petWindow, backend] = await Promise.all([
    read('../pages/SettingsPage.tsx'),
    read('../pet/PetWindow.tsx'),
    read('../../src-tauri/src/commands/pet.rs'),
  ]);
  assert.match(settings, /junqi:pet-package-pending-after/);
  assert.match(petWindow, /activate_latest_pet_package/);
  assert.match(petWindow, /newerThanUnixMs/);
  assert.match(backend, /validate_pet_manifest/);
  assert.match(backend, /newer_than_unix_ms/);
});

test('the legacy lobster remains optional rather than the default pet', async () => {
  const [store, character, skill] = await Promise.all([
    read('../stores/petStore.ts'),
    read('../pet/PetCharacter.tsx'),
    read('../../src-tauri/resources/skills/hatch-pet/SKILL.md'),
  ]);
  assert.match(store, /DEFAULT_PET_SKIN: PetSkin = 'robot'/);
  assert.match(store, /persistedVersion < 5 && skin === 'lobster'/);
  assert.match(character, /skin = 'robot'/);
  assert.match(skill, /Do not make oversized claws/);
});
