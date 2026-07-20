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

test('WIN-I18N-02 Windows installers build Chinese and English variants', () => {
  const config = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
    bundle: {
      windows: {
        nsis: { languages: string[]; displayLanguageSelector: boolean; installerHooks?: string };
        wix: { language: string[] };
      };
    };
  };
  assert.deepEqual(config.bundle.windows.nsis.languages, ['English', 'SimpChinese']);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true);
  assert.equal(config.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh');
  const hooks = read('../src-tauri/installer-hooks.nsh');
  assert.match(hooks, /!macro NSIS_HOOK_PREUNINSTALL/);
  assert.match(hooks, /--junqi-uninstall-cleanup/);
  assert.deepEqual(config.bundle.windows.wix.language, ['en-US', 'zh-CN']);
});

test('WIN-I18N-03 native tray syncs at startup and after an in-app language change', () => {
  const i18n = read('./i18n.ts');
  const tray = read('../src-tauri/src/tray/menu.rs');
  assert.match(i18n, /syncNativeLocale\(savedLang\)/);
  assert.match(i18n, /syncNativeLocale\(lang\)/);
  assert.match(tray, /TrayIconBuilder::with_id\(TRAY_ID\)/);
  assert.match(tray, /pub fn update_tray_language/);
});
