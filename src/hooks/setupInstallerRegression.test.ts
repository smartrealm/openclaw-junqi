import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupCommands = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const systemCommands = readFileSync(new URL('../../src-tauri/src/commands/system.rs', import.meta.url), 'utf8');

test('bug 03 dependency versions remain visible after installation', () => {
  assert.match(setupFlow, /\{ id: "npm",\s+label: "npm"/);
  assert.match(setupFlow, /const installedNode = await checkNode\(\)/);
  assert.match(setupFlow, /patchStep\("node", "done", installedNode\.version/);
  assert.match(setupFlow, /npmStatus = await checkNpm\(\)/);
  assert.match(setupFlow, /patchStep\("npm", "done", npmStatus\.version/);
  assert.match(setupFlow, /patchStep\("openclaw", "done", installedStatus\.version/);
});

test('bug 04 Windows setup uses managed MinGit and hidden dependency probes', () => {
  assert.match(setupCommands, /MinGit-\{\}-64-bit\.zip/);
  assert.doesNotMatch(setupCommands, /launching Git installer wizard/i);
  assert.match(setupCommands, /extract_zip_preserving_root/);
  assert.match(systemCommands, /pub async fn check_npm/);
  assert.match(systemCommands, /get_node_version[\s\S]*?configure_background_command/);
  assert.match(systemCommands, /get_git_version[\s\S]*?configure_background_command/);
});

test('npm setup step is translated in every supported locale', () => {
  const requiredKeys = [
    'setup.installSteps.npm.title',
    'setup.installSteps.npm.description',
    'setup.checkingNpm',
    'setup.installingNpm',
    'setup.npmInstallFailed',
  ];

  for (const locale of ['zh', 'en', 'ar']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of requiredKeys) {
      const nested = key.split('.').reduce<unknown>((value, part) => {
        if (!value || typeof value !== 'object') return undefined;
        return (value as Record<string, unknown>)[part];
      }, messages);
      const value = messages[key] ?? nested;
      assert.equal(typeof value, 'string', `${locale} is missing ${key}`);
      assert.notEqual((value as string).trim(), '', `${locale} has an empty ${key}`);
    }
  }
});

test('visual setup commits keep the synchronous step reference current', () => {
  assert.match(
    setupFlow,
    /const commitSteps = useCallback\([\s\S]*?stepsRef\.current = next;[\s\S]*?setSteps\(next\)/,
  );
  assert.doesNotMatch(setupFlow, /(?<!const )setSteps\((?!next\))/);
});
