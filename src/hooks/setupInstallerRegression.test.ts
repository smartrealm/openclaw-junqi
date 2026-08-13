import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { APP_LANGUAGES } from '../i18n/languages';

const setupFlow = readdirSync(new URL('./useSetupFlow/', import.meta.url))
  .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  .sort()
  .map((entry) => readFileSync(new URL(`./useSetupFlow/${entry}`, import.meta.url), 'utf8'))
  .join('\n');
const setupInstallers = readFileSync(
  new URL('./useSetupFlow/useSetupInstallers.ts', import.meta.url),
  'utf8',
);
const setupFlowRoot = readFileSync(new URL('./useSetupFlow/index.ts', import.meta.url), 'utf8');
const setupFlowPanels = readFileSync(new URL('../components/setup/SetupFlowPanels.tsx', import.meta.url), 'utf8');
const setupPage = readdirSync(new URL('../pages/SetupPage/', import.meta.url))
  .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  .sort()
  .map((entry) => readFileSync(new URL(`../pages/SetupPage/${entry}`, import.meta.url), 'utf8'))
  .join('\n');
const storageGate = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const setupCommands = readdirSync(new URL('../../src-tauri/src/commands/setup/', import.meta.url))
  .filter((entry) => entry.endsWith('.rs'))
  .sort()
  .map((entry) => readFileSync(new URL(`../../src-tauri/src/commands/setup/${entry}`, import.meta.url), 'utf8'))
  .join('\n');
const setupDiagnostics = readFileSync(new URL('../../src-tauri/src/commands/setup_diagnostics.rs', import.meta.url), 'utf8');
const setupProgress = readFileSync(new URL('../../src-tauri/src/commands/setup_progress.rs', import.meta.url), 'utf8');
const gatewayCommands = readFileSync(new URL('../../src-tauri/src/commands/gateway.rs', import.meta.url), 'utf8');
const systemCommands = readFileSync(new URL('../../src-tauri/src/commands/system.rs', import.meta.url), 'utf8');
const storageCommands = readFileSync(new URL('../../src-tauri/src/commands/storage.rs', import.meta.url), 'utf8');
const nodeRuntime = readFileSync(new URL('../../src-tauri/src/commands/node_runtime.rs', import.meta.url), 'utf8');
const runtimePolicy = readFileSync(new URL('../../src-tauri/src/commands/runtime_policy.rs', import.meta.url), 'utf8');
const paths = readFileSync(new URL('../../src-tauri/src/paths.rs', import.meta.url), 'utf8');
const platform = readFileSync(new URL('../../src-tauri/src/platform.rs', import.meta.url), 'utf8');
const appStore = readFileSync(new URL('../stores/app-store.ts', import.meta.url), 'utf8');
const tauriCommands = readFileSync(new URL('../api/tauri-commands.ts', import.meta.url), 'utf8');

test('BUG-INSTALL-LOG-01 setup diagnostics retain the full install timeline', () => {
  assert.match(setupDiagnostics, /const SETUP_SESSION_LOG: &str = "setup-session\.log"/);
  assert.match(setupDiagnostics, /const SETUP_RUNS_DIRECTORY: &str = "setup-runs"/);
  assert.match(setupDiagnostics, /matches!\(step, "node" \| "npm" \| "git" \| "openclaw" \| "gateway"\)/);
  assert.match(setupDiagnostics, /pub fn get_setup_diagnostics_directory/);
  assert.match(setupCommands, /reset_timeline_log\(&app, step\)/);
  assert.match(appStore, /const SETUP_LOG_LIMIT = 10_000/);
  assert.doesNotMatch(setupFlowPanels, /logs\.slice\(-500\)|logs\.slice\(-160\)/);
  assert.doesNotMatch(setupFlow, /clearSetupLogs/);
  assert.match(setupFlowPanels, /logs\.map\(\(log, index\) =>/);
  assert.match(setupFlowPanels, /const text = logs[\s\S]*?\.map\(/);
  assert.match(setupFlowPanels, /openSetupDiagnosticsDirectory/);
  assert.match(tauriCommands, /get_setup_diagnostics_directory/);
});

test('Gateway preparation has one current-state surface and keeps installation target details scoped to OpenClaw', () => {
  assert.doesNotMatch(setupFlowPanels, /GatewayLifecyclePanel/);
  assert.doesNotMatch(setupFlowPanels, /flow\.statusMessage/);
  assert.match(setupFlowPanels, /current\?\.id === "openclaw" && flow\.installTarget/);
});

test('step transitions populate the shared activity log even when no installer process runs', () => {
  assert.match(
    setupFlow,
    /const patchStep = useCallback[\s\S]*?appendSetupLog\(\{[\s\S]*?step: id,[\s\S]*?message: detail/,
  );
  assert.match(appStore, /const isDuplicate = previous[\s\S]*?previous\.message === nextLog\.message/);
});

test('BUG-INSTALL-LOG-12 execution records follow live output without stealing manual history review', () => {
  assert.match(setupFlowPanels, /useLayoutEffect\(\(\) => \{/);
  assert.match(setupFlowPanels, /window\.requestAnimationFrame\(scrollToLatest\)/);
  assert.match(setupFlowPanels, /if \(followRef\.current\) viewport\.scrollTop = viewport\.scrollHeight/);
  assert.match(setupFlowPanels, /followRef\.current = node\.scrollHeight - node\.scrollTop - node\.clientHeight < 48/);
});

test('BUG-INSTALL-LOG-06 through 11 preserve retries, raw process output, and exportable sessions', () => {
  assert.match(setupDiagnostics, /const RETAINED_SETUP_RUNS: usize = 8/);
  assert.match(setupDiagnostics, /dependency install attempt \{\} started/);
  assert.doesNotMatch(setupDiagnostics, /SETUP_SESSION_LOG_MAX_BYTES|SETUP_SESSION_PREVIOUS_LOG/);
  assert.match(setupDiagnostics, /pub fn record_process_output/);
  assert.match(setupDiagnostics, /pub fn record_process_started/);
  assert.match(setupDiagnostics, /pub fn record_process_finished/);
  assert.match(setupDiagnostics, /pub fn export_setup_diagnostics_bundle/);
  assert.match(setupProgress, /setup\.installPanel\.logWriteFailed/);
  assert.match(setupCommands, /record_process_output\(&app_c, &step_c, &process_label, "stdout", &line\)/);
  assert.match(setupCommands, /record_process_output\(&app_e, &step_e, &process_label, "stderr", &line\)/);
  assert.match(setupCommands, /winget \{stream\} › \{display\}/);
  assert.match(gatewayCommands, /record_process_output\([\s\S]*?"gateway"/);
  assert.match(setupFlowPanels, /exportDiagnosticsBundle/);
  assert.match(tauriCommands, /export_setup_diagnostics_bundle/);
});

test('BUG-INSTALL-LOG-02 download and npm diagnostics expose measurable bottlenecks', () => {
  assert.match(setupCommands, /response headers received in/);
  assert.match(setupCommands, /transfer_rate_mib_per_second/);
  assert.match(setupCommands, /struct NpmFetchMetrics/);
  assert.match(setupCommands, /npm network summary for/);
  assert.match(setupCommands, /cache hits=\{\}/);
  assert.match(setupCommands, /slowest=\{\}ms/);
});

test('BUG-INSTALL-LOG-05 Gateway startup uses the shared persistent diagnostic timeline', () => {
  assert.match(gatewayCommands, /fn emit_gateway_log/);
  assert.match(gatewayCommands, /fn report_gateway_lifecycle/);
  assert.match(gatewayCommands, /record_timeline_note\(app, "gateway", &line\)/);
  assert.match(gatewayCommands, /reset_timeline_log\(&app, "gateway"\)/);
  assert.match(gatewayCommands, /Preparing OpenClaw Gateway/);
  assert.match(gatewayCommands, /Checking Gateway service ownership/);
  assert.match(gatewayCommands, /Launching the OpenClaw Gateway process/);
  assert.match(gatewayCommands, /launch\.contract node=\{\} entry=\{\}/);
  assert.match(gatewayCommands, /launch\.metadata \{metadata\}/);
  assert.match(gatewayCommands, /startup\.heartbeat elapsed-s=/);
  assert.match(gatewayCommands, /activity-changed=\{\}/);
  assert.match(gatewayCommands, /startup\.timeout before-cleanup/);
  assert.match(gatewayCommands, /startup\.timeout after-cleanup/);
  assert.doesNotMatch(gatewayCommands, /launch\.contract[\s\S]{0,300}(token|env value)=/i);
  assert.equal((gatewayCommands.match(/app\.emit\(\s*"gateway-log"/g) ?? []).length, 1);
});

test('bug 03 dependency versions remain visible after installation', () => {
  assert.match(setupFlow, /\{ id: "npm",\s+label: "npm"/);
  assert.match(setupFlow, /setupNode = await checkSetupNode\(\)/);
  assert.match(setupInstallers, /nodeStatus = setupNode\.node/);
  assert.match(setupInstallers, /patchStep\("node", "done", nodeStatus\.version/);
  assert.match(setupFlow, /let npmStatus = setupNode\.npm/);
  assert.match(setupFlow, /patchStep\("npm", "done", npmStatus\.version/);
  assert.match(setupInstallers, /patchStep\("openclaw", "done", installed\.version/);
});

test('Native and Docker installation transactions have one focused owner', () => {
  assert.match(setupFlowRoot, /useSetupInstallers\(\{/);
  assert.doesNotMatch(setupFlowRoot, /const runNativeSetup = useCallback|const runDockerSetup = useCallback/);
  assert.match(setupInstallers, /const runNativeSetup = useCallback/);
  assert.match(setupInstallers, /const runDockerSetup = useCallback/);
});

test('BUG-INSTALL-12 Windows installs Git only after npm reports a missing Git process', () => {
  const nativeSteps = setupFlow.slice(
    setupFlow.indexOf('const INITIAL_NATIVE_STEPS'),
    setupFlow.indexOf('const INITIAL_DOCKER_STEPS'),
  );
  assert.match(setupFlow, /function isMissingGitDependencyError/);
  assert.doesNotMatch(nativeSteps, /id: "git"/);
  assert.match(
    setupFlow,
    /runSetupOperation\(runId, "openclaw", installSelectedOpenclaw\)[\s\S]*isMissingGitDependencyError\(error\)[\s\S]*ensureStepBefore\([\s\S]*id: "git"[\s\S]*runSetupOperation\(runId, "git", installGit\)[\s\S]*runSetupOperation\(runId, "openclaw", installSelectedOpenclaw\)/,
  );
});

test('bug 04 Windows setup installs system defaults from domestic vendor installers before package-manager fallback', () => {
  assert.match(setupCommands, /install_windows_system_node/);
  assert.match(setupCommands, /install_windows_system_node_from_mirrors/);
  assert.match(setupCommands, /install_windows_system_node_with_winget/);
  assert.match(setupCommands, /install_windows_system_git/);
  assert.match(setupCommands, /install_windows_system_git_from_mirrors/);
  assert.match(setupCommands, /ensure_winget_package/);
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
  assert.doesNotMatch(paths, /\.npm-global/);
  assert.match(paths, /pub fn configured_npm_prefix\(\)/);
  assert.match(paths, /pub fn user_npm_bin_dir\(\)/);
  assert.doesNotMatch(setupCommands, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(setupCommands, /runtime_dir\(\)\.join\("git"\)/);
  assert.match(systemCommands, /struct NodeRuntimeContract/);
  assert.doesNotMatch(systemCommands, /pub async fn check_npm/);
  assert.match(systemCommands, /probe_node_runtime_once[\s\S]*?configure_background_command/);
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
  assert.ok(gitDefaultInstall.indexOf('install_windows_system_git_from_mirrors') < gitDefaultInstall.indexOf('ensure_winget_package'));
});

test('BUG-WFR-12 Node probes honor JunQi runtime configuration without hardcoded Windows paths', () => {
  const productionSystem = systemCommands.slice(0, systemCommands.indexOf('#[cfg(test)]'));
  const configuredBranch = productionSystem.slice(
    productionSystem.indexOf('async fn node_requirement_candidates'),
    productionSystem.indexOf('// System Node.js may have multiple installations on PATH'),
  );
  assert.match(configuredBranch, /paths::configured_node_path\(\)/);
  assert.match(configuredBranch, /probe_selected_node_runtime\(&configured\)/);
  assert.doesNotMatch(configuredBranch, /detect_paths\("node"\)/);

  assert.match(productionSystem, /platform::detect_paths\("node"\)/);
  assert.match(productionSystem, /tokio::task::JoinSet::new\(\)/);
  assert.match(productionSystem, /probe_node_candidates\(candidates, 1, RUNTIME_PROBE_TIMEOUT\)/);
  assert.match(productionSystem, /Err\(RuntimeProbeFailure::TimedOut\) if attempt < attempts/);
  assert.match(setupCommands, /probe_selected_node_runtime\(node_path\)/);

  assert.doesNotMatch(productionSystem, /[A-Za-z]:\\\\(?:Users|Program Files|ProgramData|Windows)/i);
  assert.doesNotMatch(productionSystem, /AppData\\\\(?:Local|Roaming)/i);
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

test('storage read failures retry the native query without reloading the desktop WebView', () => {
  assert.match(storageGate, /onClick: \(\) => void loadStorageStatus\(\)/);
  assert.doesNotMatch(storageGate, /window\.location\.reload\(\)/);
});

test('default setup never constructs private Node.js or Git directories under OpenClaw state', () => {
  assert.doesNotMatch(paths, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(paths, /runtime_dir\(\)\.join\("git"\)/);
  assert.doesNotMatch(systemCommands, /legacy_local_(node|npm|git)_path/);
  assert.doesNotMatch(setupCommands, /default_managed_(node|git)_runtime_dir/);
  assert.doesNotMatch(storageGate, /默认托管目录/);
});

test('system-installer fallback progress is translated in every supported locale', () => {
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of [
      'setup.node.systemPackageFallback',
      'setup.git.systemPackageFallback',
      'setup.windows.installerWaiting',
      'setup.windows.packageManagerWaiting',
      'setup.windows.adminPrompt',
      'setup.node.runtimeSettling',
      'setup.git.runtimeSettling',
      'setup.git.onDemand',
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

test('BUG-INSTALL-11 Windows installer progress does not fabricate completion percentages', () => {
  assert.match(setupCommands, /progress bar at the phase boundary/);
  assert.doesNotMatch(setupCommands, /expected_install_seconds/);
  assert.match(setupCommands, /setup\.windows\.adminPrompt/);
  assert.match(setupCommands, /wait_for_node_runtime_settle/);
  assert.match(setupCommands, /wait_for_git_runtime_settle/);
});

test('BUG-INSTALL-13 winget installation is one forced, source-pinned operation', () => {
  assert.match(setupCommands, /async fn ensure_winget_package/);
  assert.match(setupCommands, /"install",[\s\S]*"--force",[\s\S]*"--source",[\s\S]*"winget"/);
  assert.doesNotMatch(setupCommands, /"upgrade"[\s\S]*winget install/);
});

test('BUG-INSTALL-14 npm failures retain redacted diagnostics for conditional Git recovery', () => {
  assert.match(setupCommands, /type NpmDiagnostics = Arc<Mutex<Vec<String>>>/);
  assert.match(setupCommands, /record_npm_diagnostic/);
  assert.match(setupCommands, /npm_diagnostic_text\(&diagnostics\)/);
  assert.match(setupFlow, /isMissingGitDependencyError\(error\)/);
});

test('npm setup step is translated in every supported locale', () => {
  const requiredKeys = [
    'setup.installSteps.npm.title',
    'setup.installSteps.npm.description',
    'setup.checkingNpm',
    'setup.npmInstallFailed',
  ];

  for (const locale of ['zh', 'zh-TW', 'en']) {
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
    /const commitSteps = useCallback\([\s\S]*?sanitizeSetupDiagnostic\(step\.detail\)[\s\S]*?stepsRef\.current = safe;[\s\S]*?setSteps\(safe\)/,
  );
  assert.doesNotMatch(setupFlow, /stepsRef\.current = next;[\s\S]*?setSteps\(next\)/);
});

test('installation steps and activity log use aligned fixed-height viewports', () => {
  assert.equal((setupFlowPanels.match(/h-\[390px\]/g) ?? []).length, 2);
  assert.equal((setupFlowPanels.match(/h-\[342px\]/g) ?? []).length, 2);
  assert.match(setupFlowPanels, /flex h-12 items-center border-b/);
  assert.match(setupFlowPanels, /rowRefs\.current\.get\(current\.id\)/);
  assert.match(setupFlowPanels, /viewport\.scrollTo\(\{/);
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
  const progressScreen = setupPage.slice(
    setupPage.indexOf('function ProgressScreen'),
    setupPage.indexOf('function wizardInitialValue'),
  );

  assert.match(setupFlow, /appendSetupLog\(\{[\s\S]*?level: "error"/);
  assert.doesNotMatch(setupPage, /setup\.copyError/);
  assert.doesNotMatch(progressScreen, /navigator\.clipboard/);
});

test('a missing prerequisite reaches its own recovery screen', () => {
  const helpers = readFileSync(new URL('./useSetupFlow/helpers.ts', import.meta.url), 'utf8');
  assert.match(helpers, /class SetupPrerequisiteError extends Error/);
  assert.match(helpers, /"git-missing" \| "node-missing"/);

  assert.match(setupInstallers, /throw new SetupPrerequisiteError\(\s*"node-missing"/);
  assert.match(setupInstallers, /throw new SetupPrerequisiteError\("git-missing"/);
  assert.match(
    setupInstallers,
    /if \(error instanceof SetupPrerequisiteError\) \{[\s\S]*?setNeedsGit\(true\)[\s\S]*?replaceSetupStep\(error\.step\)/,
  );

  const router = readFileSync(new URL('../pages/SetupPage/index.tsx', import.meta.url), 'utf8');
  assert.match(router, /case "git-missing": return <GitMissingScreen/);
  assert.match(router, /case "node-missing": return <NodeMissingScreen/);
  const gitScreen = readFileSync(new URL('../pages/SetupPage/GitMissingScreen.tsx', import.meta.url), 'utf8');
  const nodeScreen = readFileSync(new URL('../pages/SetupPage/NodeMissingScreen.tsx', import.meta.url), 'utf8');
  assert.match(gitScreen, /flow\.retryGit\(\)/);
  assert.match(nodeScreen, /flow\.retryNode\(\)/);
});

test('BUG-GW-STALE-01 a Gateway started before an OpenClaw install is not adopted as-is', () => {
  // The reuse branch only proved the endpoint was healthy and accepted the
  // configured token — both of which a Gateway started before the install still
  // satisfies while serving the previous package. A repair or upgrade then
  // reported success with the old code still answering.
  const state = readFileSync(new URL('../../src-tauri/src/state/gateway_process.rs', import.meta.url), 'utf8');
  assert.match(state, /pub openclaw_package_replaced: AtomicBool/);
  assert.match(setupCommands, /openclaw_package_replaced\s*\.store\(true, Ordering::Release\)/);

  // Owners JunQi controls are displaced; an external process is only reported,
  // never terminated.
  assert.match(
    gatewayCommands,
    /fn should_take_over_stale_gateway\([\s\S]*?openclaw_package_replaced && !matches!\(reused_mode, GatewayRuntimeMode::External\)/,
  );
  assert.match(gatewayCommands, /let stale_owner_takeover = should_take_over_stale_gateway\(/);
  assert.match(gatewayCommands, /if !stale_owner_takeover \{/);

  // Only a start JunQi drove to readiness clears the flag.
  assert.equal((gatewayCommands.match(/mark_running_gateway_current\(&state\)/g) ?? []).length, 4);
});

test('BUG-GW-I18N-02 Gateway lifecycle lines carry translation keys', () => {
  // `gateway-log` shipped bare English while the setup console around it was
  // translated, because the payload had no key channel at all.
  assert.match(gatewayCommands, /struct GatewayLogEvent<'a> \{[\s\S]*?key: Option<&'a str>/);
  assert.match(gatewayCommands, /fn report_gateway_lifecycle_keyed\(/);
  assert.match(gatewayCommands, /Some\("setup\.gateway\.reuseExisting"\)/);
  assert.match(gatewayCommands, /Some\("setup\.gateway\.launching"\)/);

  // Every locale resolves the keys the Gateway start path emits.
  const keys = [...gatewayCommands.matchAll(/Some\("(setup\.gateway\.[A-Za-z]+)"\)/g)]
    .map((match) => match[1]!);
  assert.ok(keys.length >= 20, `expected the start path to be keyed, found ${keys.length}`);
  for (const locale of APP_LANGUAGES) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of new Set(keys)) {
      assert.equal(typeof messages[key], 'string', `${locale} is missing ${key}`);
    }
  }
});
