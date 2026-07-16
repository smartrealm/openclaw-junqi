import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupFlowPanels = readFileSync(new URL('../components/setup/SetupFlowPanels.tsx', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const storageGate = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const setupCommands = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const systemCommands = readFileSync(new URL('../../src-tauri/src/commands/system.rs', import.meta.url), 'utf8');
const storageCommands = readFileSync(new URL('../../src-tauri/src/commands/storage.rs', import.meta.url), 'utf8');
const nezhaUnixPlatform = readFileSync(new URL('../../src-tauri/src/nezha/platform/unix.rs', import.meta.url), 'utf8');

test('bug 03 dependency versions remain visible after installation', () => {
  assert.match(setupFlow, /\{ id: "npm",\s+label: "npm"/);
  assert.match(setupFlow, /const installedNode = await checkNode\(\)/);
  assert.match(setupFlow, /patchStep\("node", "done", installedNode\.version/);
  assert.match(setupFlow, /npmStatus = await checkNpm\(\)/);
  assert.match(setupFlow, /patchStep\("npm", "done", npmStatus\.version/);
  assert.match(setupFlow, /patchStep\("openclaw", "done", installedStatus\.version/);
});

test('bug 04 Windows setup uses system defaults unless the user selected a portable runtime', () => {
  assert.match(setupCommands, /install_windows_system_node/);
  assert.match(setupCommands, /install_windows_system_git/);
  assert.match(setupCommands, /install_or_upgrade_winget_package/);
  assert.match(setupCommands, /paths::configured_node_runtime_dir\(\)/);
  assert.match(setupCommands, /paths::configured_git_runtime_dir\(\)/);
  assert.match(setupCommands, /install_windows_portable_node/);
  assert.match(setupCommands, /install_windows_portable_git/);
  assert.match(setupCommands, /CHINA_NODE_INDEX/);
  assert.match(setupCommands, /resolve_node_sha256/);
  assert.match(setupCommands, /resolve_latest_managed_git_artifact/);
  assert.match(setupCommands, /verified_fallback_managed_git_artifact/);
  assert.match(setupCommands, /activate_staged_runtime/);
  assert.match(setupCommands, /refresh_path_from_registry\(\)/);
  assert.match(systemCommands, /configured_node_path/);
  assert.match(systemCommands, /legacy_local_node_path/);
  assert.match(systemCommands, /configured_git_path/);
  assert.match(systemCommands, /legacy_local_git_path/);
  assert.doesNotMatch(systemCommands, /macos_git_candidates/);
  assert.doesNotMatch(systemCommands, /\.npm-global"\)\.join\("bin"\)\.join\("git"\)/);
  assert.doesNotMatch(nezhaUnixPlatform, /\.npm-global/);
  assert.match(nezhaUnixPlatform, /configured_npm_prefix\(\)/);
  assert.match(nezhaUnixPlatform, /user_npm_bin_dir\(\)/);
  assert.doesNotMatch(setupCommands, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(setupCommands, /runtime_dir\(\)\.join\("git"\)/);
  assert.match(systemCommands, /pub async fn check_npm/);
  assert.match(systemCommands, /get_node_version[\s\S]*?configure_background_command/);
  assert.match(systemCommands, /get_git_version[\s\S]*?configure_background_command/);
});

test('dependency runtime locations are explicit onboarding choices instead of children of OpenClaw storage', () => {
  assert.match(storageGate, /customNodeRuntime/);
  assert.match(storageGate, /customGitRuntime/);
  assert.match(storageGate, /nodeRuntimeDir: customNodeRuntime \? nodeRuntimeDir\.trim\(\) \|\| null : null/);
  assert.match(storageGate, /gitRuntimeDir: customGitRuntime \? gitRuntimeDir\.trim\(\) \|\| null : null/);
  assert.match(storageCommands, /node_runtime_dir: Option<String>/);
  assert.match(storageCommands, /git_runtime_dir: Option<String>/);
  assert.match(storageCommands, /custom Node\.js runtime directory/);
  assert.match(storageCommands, /custom Git runtime directory/);
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

test('mobile installation console switches between steps and logs', () => {
  assert.match(setupFlowPanels, /useState<"steps" \| "logs">\("steps"\)/);
  assert.match(setupFlowPanels, /setup\.installPanel\.timeline/);
  assert.match(setupFlowPanels, /setup\.installPanel\.activity/);
  assert.match(setupFlowPanels, /mobileView !== "steps" && "hidden lg:block"/);
  assert.match(setupFlowPanels, /mobileView !== "logs" && "hidden lg:block"/);
});

test('installation steps and activity log use aligned fixed-height viewports', () => {
  assert.equal((setupFlowPanels.match(/h-\[390px\]/g) ?? []).length, 2);
  assert.equal((setupFlowPanels.match(/h-\[342px\]/g) ?? []).length, 2);
  assert.match(setupFlowPanels, /flex h-12 items-center border-b/);
  assert.match(setupFlowPanels, /rowRefs\.current\.get\(current\.id\)/);
  assert.match(setupFlowPanels, /viewport\.scrollTo\(\{/);
});

test('Gateway is an explicit visible setup step that prepares the bundled OpenClaw service', () => {
  assert.match(setupFlowPanels, /titleFallback: "OpenClaw Gateway"/);
  assert.match(setupFlowPanels, /descriptionFallback: "验证 Gateway 配置并准备启动控制通道"/);
  assert.match(setupFlow, /await prepareGateway\(\)/);
  assert.match(setupFlow, /gatewayPrepareWarning \?\? t\("setup\.installCompleteGatewayPending"/);
  assert.match(setupFlow, /level: "warn"/);
  assert.match(setupFlow, /reportPhase\("awaitingGatewayStart"/);
});

test('installation footer reports the current step instead of a live log message', () => {
  assert.match(setupPage, /const runningStepLabel = t\("setup\.installPanel\.runningStep"/);
  assert.match(setupPage, /label: runningStepLabel, disabled: true/);
  assert.doesNotMatch(setupPage, /label: flow\.statusMessage \|\| t\("setup\.settingUp"\)/);
});

test('Gateway setup errors expose explicit repair and direct retry actions', () => {
  assert.match(setupPage, /canRepairGateway/);
  assert.match(setupPage, /setup\.repairAndRetry/);
  assert.match(setupPage, /flow\.repairAndRetry\(\)/);
  assert.match(setupPage, /setup\.retryDirectly/);
  assert.match(setupFlow, /runOpenClawRepair/);
  assert.match(setupFlow, /if \(!isRunActive\(runId\)\) return/);
  assert.match(setupPage, /flow\.retryGateway\(\)/);
  assert.match(setupFlow, /await startGatewayAction\(\)/);
});

test('setup failures are retained in the copyable activity log without a duplicate error card', () => {
  assert.match(setupFlow, /appendSetupLog\(\{[\s\S]*?level: "error"/);
  assert.doesNotMatch(setupPage, /setup\.copyError/);
  assert.doesNotMatch(setupPage, /navigator\.clipboard/);
});
