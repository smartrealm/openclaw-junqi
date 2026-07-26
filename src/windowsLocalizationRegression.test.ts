import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const requiredSetupKeys = [
  'setup.node.systemInstall',
  'setup.node.systemCurrentInstall',
  'setup.node.systemReady',
  'setup.git.systemInstall',
  'setup.git.systemReady',
  'setup.windows.adminPrompt',
  'setup.node.runtimeSettling',
  'setup.git.runtimeSettling',
];

test('WIN-I18N-01 system dependency progress has every supported translation', () => {
  for (const language of ['zh', 'zh-TW', 'en', 'ar']) {
    const locale = JSON.parse(read(`./locales/${language}.json`)) as Record<string, unknown>;
    for (const key of requiredSetupKeys) {
      assert.equal(typeof locale[key], 'string', `${language} must define ${key}`);
    }
  }
});

test('WIN-I18N-02 Windows NSIS installer builds Chinese and English variants', () => {
  const config = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
    bundle: {
      windows: {
        nsis: { languages: string[]; displayLanguageSelector: boolean; installerHooks?: string };
      };
    };
  };
  assert.deepEqual(config.bundle.windows.nsis.languages, ['English', 'SimpChinese']);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true);
  assert.equal(config.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh');
  const hooks = read('../src-tauri/installer-hooks.nsh');
  assert.match(hooks, /!macro NSIS_HOOK_PREUNINSTALL/);
  assert.match(hooks, /--junqi-uninstall-cleanup/);
  assert.match(hooks, /\$0 != 0[\s\S]*?MessageBox MB_OK\|MB_ICONSTOP[\s\S]*?Abort/);
  assert.match(hooks, /junqi_cleanup_missing:[\s\S]*?MessageBox MB_OK\|MB_ICONSTOP[\s\S]*?Abort/);
});

test('WIN-I18N-03 uninstall cleanup removes only the selected owned Docker container', () => {
  const uninstall = read('../src-tauri/src/commands/uninstall.rs');
  const docker = read('../src-tauri/src/commands/docker.rs');
  assert.match(uninstall, /runtime_mode == paths::OpenClawRuntimeMode::Docker/);
  assert.match(uninstall, /remove_selected_container_for_uninstall\(\)\.await/);
  assert.match(docker, /ContainerPresence::Managed \{ state_id, \.\. \} if state_id == selected_state_id/);
  assert.match(docker, /ContainerPresence::Foreign[\s\S]*?UninstallContainerAction::NothingOwned/);
  assert.match(docker, /remove_selected_container_for_uninstall[\s\S]*?remove_named_container/);
  assert.doesNotMatch(docker, /remove_selected_container_for_uninstall[\s\S]*?legacy_container_matches_layout/);
});

test('WIN-I18N-04 native tray syncs at startup and after an in-app language change', () => {
  const i18n = read('./i18n.ts');
  const tray = read('../src-tauri/src/tray/menu.rs');
  assert.match(i18n, /syncNativeLocale\(savedLang\)/);
  assert.match(i18n, /syncNativeLocale\(lang\)/);
  assert.match(tray, /TrayIconBuilder::with_id\(TRAY_ID\)/);
  assert.match(tray, /pub fn update_tray_language/);
});
