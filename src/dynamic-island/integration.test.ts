import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(projectRoot, path), 'utf8');

test('native island window keeps the desktop-overlay contract', () => {
  const source = read('src-tauri/src/commands/dynamic_island.rs');
  for (const required of [
    '.decorations(false)',
    '.transparent(true)',
    '.skip_taskbar(true)',
    '.always_on_top(true)',
    '.shadow(false)',
    '.resizable(false)',
    '.focused(false)',
    '.accept_first_mouse(true)',
    'set_ignore_cursor_events(ignore)',
    'set_visible_on_all_workspaces(true)',
    'WINDOW_LIFECYCLE_GATE',
    'lifecycle_gate().lock().await',
    'MACOS_STATUS_BAR_WINDOW_LEVEL',
    'setFrame: cocoa_frame',
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('dynamic island commands and auxiliary root stay wired into Tauri', () => {
  const lib = read('src-tauri/src/lib.rs');
  const main = read('src/main.tsx');
  const tray = read('src-tauri/src/tray/menu.rs');
  const capability = JSON.parse(read('src-tauri/capabilities/default.json')) as {
    windows: string[];
    permissions: string[];
  };
  for (const command of [
    'open_dynamic_island',
    'close_dynamic_island',
    'set_dynamic_island_expanded',
    'set_dynamic_island_click_through',
    'dynamic_island_focus_main',
  ]) {
    assert.match(lib, new RegExp(`commands::dynamic_island::${command}`));
  }
  assert.match(main, /windowLabel === 'dynamic-island'/);
  assert.match(main, /import\('\.\/dynamic-island\/DynamicIsland'\)/);
  assert.match(tray, /toggle_dynamic_island/);
  assert.ok(capability.windows.includes('dynamic-island'));
  assert.ok(capability.permissions.includes('core:event:allow-emit'));
  assert.ok(capability.permissions.includes('core:event:allow-listen'));
});

test('dynamic island lifecycle does not surface event transport failures as global rejections', () => {
  const island = read('src/dynamic-island/DynamicIsland.tsx');
  const runtime = read('src/dynamic-island/DynamicIslandRuntime.tsx');

  assert.match(island, /emitTauriEvent\('dynamic-island:ready'\)\.catch\(\(\) => undefined\)/);
  assert.match(runtime, /void openAndSynchronize\(\)\.catch\(\(\) => undefined\)/);
});

test('file drag handoff cannot steal the operating-system drop target', () => {
  const runtime = read('src/dynamic-island/DynamicIslandRuntime.tsx');
  assert.match(runtime, /subscribeTauriEvent<string\[]>\('aegis:drag-active'/);
  assert.match(runtime, /set_dynamic_island_click_through', \{ ignore: true \}/);
  assert.match(runtime, /subscribeTauriEvent<string\[]>\('aegis:file-dropped'/);
  assert.match(runtime, /set_dynamic_island_click_through', \{ ignore: false \}/);
});

test('island returns to the existing chat session and uses packaged JunQi branding', () => {
  const island = read('src/dynamic-island/DynamicIsland.tsx');
  const runtime = read('src/dynamic-island/DynamicIslandRuntime.tsx');
  const styles = read('src/dynamic-island/dynamic-island.css');

  assert.match(island, /JunQiLogo/);
  assert.match(island, /type: 'open-session', sessionKey: snapshot\.sessionKey/);
  assert.doesNotMatch(island, /src="\/src\/assets\/brand\/junqi-emblem\.svg"/);
  assert.match(runtime, /chat\.setActiveSession\(action\.sessionKey\)/);
  assert.match(runtime, /dynamic_island_focus_main', \{ route: '\/chat' \}/);
  assert.doesNotMatch(runtime, /open_quickchat_with_files', \{ paths: \[\] \}/);
  assert.match(styles, /var\(--aegis-bg-frosted\)/);
  assert.match(styles, /var\(--aegis-primary\)/);
});

test('settings expose conditional display and important-activity expansion', () => {
  const settings = read('src/pages/SettingsPage.tsx');
  const zh = JSON.parse(read('src/locales/zh.json')) as { settings: Record<string, string> };
  const en = JSON.parse(read('src/locales/en.json')) as { settings: Record<string, string> };
  assert.match(settings, /dynamicIslandEnabled/);
  assert.match(settings, /dynamicIslandAutoExpand/);
  for (const catalog of [zh, en]) {
    assert.ok(catalog.settings.dynamicIslandDesc);
    assert.ok(catalog.settings.dynamicIslandAutoExpandDesc);
  }
});
