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
const nodeRuntime = readFileSync(new URL('../../src-tauri/src/commands/node_runtime.rs', import.meta.url), 'utf8');
const runtimePolicy = readFileSync(new URL('../../src-tauri/src/commands/runtime_policy.rs', import.meta.url), 'utf8');
const paths = readFileSync(new URL('../../src-tauri/src/paths.rs', import.meta.url), 'utf8');
const platform = readFileSync(new URL('../../src-tauri/src/platform.rs', import.meta.url), 'utf8');
const nezhaUnixPlatform = readFileSync(new URL('../../src-tauri/src/nezha/platform/unix.rs', import.meta.url), 'utf8');

test('bug 03 dependency versions remain visible after installation', () => {
  assert.match(setupFlow, /\{ id: "npm",\s+label: "npm"/);
  assert.match(setupFlow, /setupNode = await checkSetupNode\(\)/);
  assert.match(setupFlow, /const installedNode = setupNode\.node/);
  assert.match(setupFlow, /patchStep\("node", "done", installedNode\.version/);
  assert.match(setupFlow, /let npmStatus = setupNode\.npm/);
  assert.match(setupFlow, /patchStep\("npm", "done", npmStatus\.version/);
  assert.match(setupFlow, /patchStep\("openclaw", "done", installedStatus\.version/);
});

test('bug 04 Windows setup installs system defaults from domestic vendor installers before package-manager fallback', () => {
  assert.match(setupCommands, /install_windows_system_node/);
  assert.match(setupCommands, /install_windows_system_node_from_mirrors/);
  assert.match(setupCommands, /install_windows_system_node_with_winget/);
  assert.match(setupCommands, /install_windows_system_git/);
  assert.match(setupCommands, /install_windows_system_git_from_mirrors/);
  assert.match(setupCommands, /install_or_upgrade_winget_package/);
  assert.match(setupCommands, /WINGET_NODE_LTS_PACKAGE/);
  assert.match(setupCommands, /WINGET_GIT_PACKAGE/);
  assert.match(setupCommands, /paths::configured_node_runtime_dir\(\)/);
  assert.match(setupCommands, /paths::configured_git_runtime_dir\(\)/);
  assert.match(setupCommands, /install_portable_node_runtime/);
  assert.match(setupCommands, /install_windows_portable_git/);
  assert.doesNotMatch(setupCommands, /default_managed_(node|git)_runtime_dir/);
  assert.doesNotMatch(setupCommands, /NODE_DISTRIBUTION_(BASES|SOURCES)/);
  assert.match(nodeRuntime, /NODE_DISTRIBUTION_CATALOG/);
  assert.match(nodeRuntime, /node_installer_sources/);
  assert.match(setupCommands, /resolve_node_sha256/);
  assert.match(setupCommands, /verified_managed_git_artifact/);
  assert.match(setupCommands, /verified_system_git_installer_artifact/);
  assert.match(setupCommands, /run_windows_installer/);
  assert.doesNotMatch(setupCommands, /resolve_latest_managed_git_artifact/);
  assert.match(setupCommands, /activate_staged_runtime/);
  assert.match(setupCommands, /platform::refresh_process_path_from_registry\(\)/);
  assert.match(platform, /fn refresh_windows_path_from_registry/);
  assert.match(platform, /fn ensure_windows_path_for_discovery/);
  assert.match(systemCommands, /configured_node_path/);
  assert.match(systemCommands, /configured_git_path/);
  assert.match(systemCommands, /platform::detect_paths\("git"\)/);
  assert.doesNotMatch(systemCommands, /legacy_local_(node|npm|git)_path/);
  assert.doesNotMatch(systemCommands, /macos_git_candidates/);
  assert.doesNotMatch(systemCommands, /\.npm-global"\)\.join\("bin"\)\.join\("git"\)/);
  assert.doesNotMatch(nezhaUnixPlatform, /\.npm-global/);
  assert.match(nezhaUnixPlatform, /configured_npm_prefix\(\)/);
  assert.match(nezhaUnixPlatform, /user_npm_bin_dir\(\)/);
  assert.doesNotMatch(setupCommands, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(setupCommands, /runtime_dir\(\)\.join\("git"\)/);
  assert.match(systemCommands, /struct NodeRuntimeContract/);
  assert.doesNotMatch(systemCommands, /pub async fn check_npm/);
  assert.match(systemCommands, /resolve_node_runtime[\s\S]*?configure_background_command/);
  assert.match(systemCommands, /get_git_version[\s\S]*?configure_background_command/);

  const nodeDefaultInstall = setupCommands.slice(
    setupCommands.indexOf('async fn install_windows_system_node('),
    setupCommands.indexOf('async fn install_windows_system_node_from_mirrors('),
  );
  assert.ok(nodeDefaultInstall.indexOf('install_windows_system_node_from_mirrors') < nodeDefaultInstall.indexOf('install_windows_system_node_with_winget'));

  const gitDefaultInstall = setupCommands.slice(
    setupCommands.indexOf('async fn install_windows_system_git('),
    setupCommands.indexOf('async fn install_windows_system_git_from_mirrors('),
  );
  assert.ok(gitDefaultInstall.indexOf('install_windows_system_git_from_mirrors') < gitDefaultInstall.indexOf('install_or_upgrade_winget_package'));
});

test('dependency runtime locations are explicit onboarding choices instead of children of OpenClaw storage', () => {
  assert.match(storageGate, /customNodeRuntime/);
  assert.match(storageGate, /customGitRuntime/);
  assert.match(storageGate, /nodeRuntimeDir: status\.customNodeRuntimeSupported && customNodeRuntime \? nodeRuntimeDir\.trim\(\) \|\| null : null/);
  assert.match(storageGate, /gitRuntimeDir: status\.customGitRuntimeSupported && customGitRuntime \? gitRuntimeDir\.trim\(\) \|\| null : null/);
  assert.match(storageCommands, /node_runtime_dir: Option<String>/);
  assert.match(storageCommands, /git_runtime_dir: Option<String>/);
  assert.match(storageCommands, /custom Node\.js runtime directory/);
  assert.match(storageCommands, /custom Git runtime directory/);
  assert.match(storageGate, /status\.customNodeRuntimeSupported/);
  assert.match(storageGate, /status\.customGitRuntimeSupported/);
  assert.match(storageCommands, /custom_node_runtime_supported: capabilities\.node/);
  assert.match(storageCommands, /custom_git_runtime_supported: capabilities\.git/);
  assert.match(runtimePolicy, /node: ManagedNodePlatform::for_target\(os, architecture\)\.is_ok\(\)/);
  assert.match(runtimePolicy, /git: os == "windows" && supported_architecture/);
  assert.match(storageCommands, /Custom portable Git is only supported on Windows/);
});

test('default setup never constructs private Node.js or Git directories under OpenClaw state', () => {
  assert.doesNotMatch(paths, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(paths, /runtime_dir\(\)\.join\("git"\)/);
  assert.doesNotMatch(systemCommands, /legacy_local_(node|npm|git)_path/);
  assert.doesNotMatch(setupCommands, /default_managed_(node|git)_runtime_dir/);
  assert.doesNotMatch(storageGate, /默认托管目录/);
});

test('system-installer fallback progress is translated in every supported locale', () => {
  for (const locale of ['zh', 'en', 'ar']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of [
      'setup.node.systemPackageFallback',
      'setup.git.systemPackageFallback',
      'setup.windows.installerWaiting',
      'setup.windows.packageManagerWaiting',
    ]) {
      assert.equal(typeof messages[key], 'string', `${locale} is missing ${key}`);
      assert.notEqual((messages[key] as string).trim(), '', `${locale} has an empty ${key}`);
    }
  }
});

test('BUG-INSTALL-10 Windows installer and package-manager waits keep setup progress alive', () => {
  assert.match(setupCommands, /struct WindowsInstallProgress/);
  assert.match(setupCommands, /report_installer_wait/);
  assert.match(setupCommands, /report_package_manager_wait/);
  assert.match(setupCommands, /async fn wait_for_controlled_child[\s\S]*report_heartbeat/);
  assert.match(setupCommands, /async fn run_windows_installer[\s\S]*wait_for_elevated_windows_process/);
  assert.match(setupCommands, /async fn run_winget_package_command[\s\S]*wait_for_controlled_child[\s\S]*report_package_manager_wait/);
  assert.match(setupCommands, /WindowsInstallProgress::new\(app, "node", "Node\.js", 0\.64, 0\.92\)/);
  assert.match(setupCommands, /WindowsInstallProgress::new\(app, "git", "Git", 0\.64, 0\.92\)/);
});

test('npm setup step is translated in every supported locale', () => {
  const requiredKeys = [
    'setup.installSteps.npm.title',
    'setup.installSteps.npm.description',
    'setup.checkingNpm',
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

test('installation progress has distinct running, success, and failure visuals', () => {
  assert.equal(
    (setupFlowPanels.match(/linear-gradient\(90deg, rgb\(var\(--aegis-primary\)\), rgb\(var\(--aegis-success\)\)/g) ?? []).length,
    3,
  );
  assert.match(setupFlowPanels, /!isReady && !isError && "animate-pulse"/);
  assert.match(setupFlowPanels, /isError\s*\? ["']rgb\(248 113 113\)["']/);
  assert.match(setupFlowPanels, /isReady\s*\? ["']rgb\(var\(--aegis-success\)\)["']/);
  assert.match(setupFlowPanels, /isError \|\| isReady \? ["']none["'] : ["']0 0 14px/);
});

test('Gateway preparation automatically continues into first-run visual configuration', () => {
  assert.match(setupFlowPanels, /titleFallback: "OpenClaw Gateway"/);
  assert.match(setupFlowPanels, /descriptionFallback: "验证 Gateway 配置并准备启动控制通道"/);
  assert.match(setupFlow, /await prepareGateway\(\)/);
  assert.match(setupFlow, /gatewayPrepareWarning \?\? t\("setup\.preparingGateway"\)/);
  assert.match(setupFlow, /await startGatewayAction\(\)/);
  assert.doesNotMatch(setupFlow, /if \(gatewayPrepareWarning\)[\s\S]{0,240}replaceSetupStep\("install-complete"\)/);
  assert.match(setupFlow, /level: "warn"/);
});

test('existing installations without a model bootstrap Gateway before the visual wizard', () => {
  const storageCompletion = setupFlow.slice(
    setupFlow.indexOf('const completeStorageSetup = useCallback'),
    setupFlow.indexOf('const repairAndRetry = useCallback'),
  );

  assert.match(storageCompletion, /nextStep === "gateway-stopped" && needsOnboardingRef\.current/);
  assert.match(storageCompletion, /void startGatewayAction\(\)/);
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
