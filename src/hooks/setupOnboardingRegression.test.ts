import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const setupFlowPanels = readFileSync(new URL('../components/setup/SetupFlowPanels.tsx', import.meta.url), 'utf8');
const storageGate = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const appStore = readFileSync(new URL('../stores/app-store.ts', import.meta.url), 'utf8');
const gatewayClient = readFileSync(new URL('../services/gateway/index.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../api/tauri-adapter.ts', import.meta.url), 'utf8');
const settingsStore = readFileSync(new URL('../stores/settingsStore.ts', import.meta.url), 'utf8');
const settingsPage = readFileSync(new URL('../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const settingsDialog = readFileSync(new URL('../components/shared/AppSettingsDialog.tsx', import.meta.url), 'utf8');
const setupCommand = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const gatewayCommand = readFileSync(new URL('../../src-tauri/src/commands/gateway.rs', import.meta.url), 'utf8');

function flattenMessages(value: unknown, prefix = '', result: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      flattenMessages(entry, path, result);
    } else {
      result[path] = entry;
    }
  }
  return result;
}

test('BUG-ONB-01 stale detection cannot override Back navigation', () => {
  const detection = setupFlow.slice(
    setupFlow.indexOf('// ── 挂载后自动检测'),
    setupFlow.indexOf('// ── Docker detect'),
  );

  assert.match(detection, /let cancelled = false/);
  assert.match(detection, /await detectGatewayConfig\(\);\s*if \(cancelled\) return/);
  assert.match(detection, /const oclaw = await checkOpenclaw\(\);\s*if \(cancelled\) return/);
  assert.match(setupFlow, /await window\.aegis\.config\.detect\(\);/);
  assert.match(detection, /return \(\) => \{\s*cancelled = true/);
});

test('BUG-ONB-04 update completion preserves the OpenClaw onboarding gate', () => {
  const stopped = setupPage.slice(
    setupPage.indexOf('function GatewayStoppedScreen'),
    setupPage.indexOf('function ModeSelectScreen'),
  );

  assert.match(stopped, /flow\.needsOnboarding \? "configure-openclaw" : "ready"/);
});

test('BUG-ONB-16 wizard completion requires authenticated post-handoff Gateway readiness', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('if (result.done || result.status === "done")'),
    setupFlow.indexOf('const startOfficialOnboarding = useCallback'),
  );

  assert.match(completion, /await invoke<boolean>\("handoff_gateway_to_official_service", \{\}\)/);
  assert.match(completion, /await invoke<boolean>\("probe_selected_gateway", \{\}\)/);
  assert.match(completion, /replaceSetupStep\("error"\)/);
  assert.doesNotMatch(completion, /handoffError[\s\S]*level: "warn"/);
});

test('BUG-ONB-34 cached setup validates installation before Gateway recovery', () => {
  const validation = app.slice(
    app.indexOf('// The local marker is only a cache.'),
    app.indexOf('useEffect(() => {', app.indexOf('}, [cachedSetupValidationPending, setupComplete]);') + 1),
  );

  assert.match(validation, /validateCachedSetupInstallation\(\)/);
  assert.doesNotMatch(validation, /probe_selected_gateway/);
  assert.ok(
    (app.match(/if \(cachedSetupValidationPending\) return;/g) ?? []).length >= 2,
    'cold recovery and Gateway callback registration must wait for cached setup validation',
  );
  assert.match(app, /setupComplete === true && cachedSetupValidationPending/);
});

test('BUG-ONB-32 official wizard RPCs use an admin connection and retain failure diagnostics', () => {
  const clientSetup = setupFlow.slice(
    setupFlow.indexOf('new OpenClawWizardClient'),
    setupFlow.indexOf('const progressRef'),
  );
  const failure = setupFlow.slice(
    setupFlow.indexOf('const wizardFailureMessage'),
    setupFlow.indexOf('const presentSetupStep'),
  );

  assert.match(clientSetup, /gateway\.callPrivileged\(method, params, options\)/);
  assert.doesNotMatch(clientSetup, /gateway\.call\(method, params, options\)/);
  assert.match(failure, /diagnosticSessionId/);
  assert.match(failure, /\$\{diagnostic\}/);
  assert.match(failure, /GatewayPrivilegedAuthorizationError/);
});

test('BUG-ONB-33 setup renders the official pairing approval surface', () => {
  const setupBranch = app.slice(
    app.indexOf('if (!setupComplete)'),
    app.indexOf('return (', app.indexOf('if (!setupComplete)') + 30),
  );

  assert.match(app, /subscribePrivilegedAuthorizationIssues/);
  assert.match(setupBranch, /pairingIssue/);
  assert.match(setupBranch, /<PairingScreen/);
  assert.match(setupBranch, /onPaired=\{handlePairingComplete\}/);
});

test('BUG-ONB-34 a failed cached Gateway probe invalidates the persisted setup marker', () => {
  const healthGate = app.slice(
    app.indexOf('// The local marker is only a cache.'),
    app.indexOf("useEffect(() => {\n    const updateRoutePath"),
  );

  assert.match(healthGate, /invoke<boolean>\('probe_selected_gateway'/);
  assert.equal((healthGate.match(/setSetupComplete\(false\)/g) ?? []).length, 2);
  assert.doesNotMatch(healthGate, /setSetupComplete\(null\)/);
});

test('BUG-ONB-37 dashboard completion re-probes Gateway before committing the setup marker', () => {
  const entry = setupFlow.slice(
    setupFlow.indexOf('const enterDashboard = useCallback'),
    setupFlow.indexOf('const detectDocker = useCallback'),
  );

  assert.match(entry, /await invoke<boolean>\("probe_selected_gateway", \{\}\)/);
  assert.ok(entry.indexOf('probe_selected_gateway') < entry.indexOf('setSetupComplete(true)'));
  assert.match(entry, /replaceSetupStep\("gateway-stopped"\)/);
  assert.match(entry, /dashboardEntryInFlightRef\.current/);
});

test('BUG-ONB-38 Ready navigation is locked during autostart handoff and final Gateway verification', () => {
  const ready = setupPage.slice(
    setupPage.indexOf('function ReadyScreen'),
    setupPage.indexOf('function ErrorScreen'),
  );
  const autostart = setupPage.slice(
    setupPage.indexOf('function GatewayAutostartPreference'),
    setupPage.indexOf('function ReadyScreen'),
  );

  assert.match(autostart, /onOperationStateChange\(busy\)/);
  assert.match(ready, /blockNavigation = autostartBusy \|\| flow\.enteringDashboard/);
  assert.match(ready, /previousAction=\{\{ onClick: flow\.goBack, disabled: blockNavigation \}\}/);
  assert.match(ready, /disabled: blockNavigation/);
});

test('BUG-ONB-35 notification permission waits until onboarding is complete', () => {
  const notificationPermission = app.slice(
    app.indexOf('// ── Request notification permission'),
    app.indexOf('// OpenClaw exposes durable transcript updates'),
  );

  assert.match(notificationPermission, /if \(setupComplete !== true\) return/);
  assert.match(notificationPermission, /notifications\.requestPermission\(\)/);
  assert.match(notificationPermission, /\}, \[setupComplete\]\)/);
});

test('BUG-WFR-01 privileged pairing retries can resolve or be cancelled by the host', () => {
  assert.match(gatewayClient, /subscribePrivilegedAuthorizationResolved/);
  assert.match(gatewayClient, /pairingRetryMs\s*\?\?\s*5_000/);
  assert.match(gatewayClient, /cancelPrivilegedAuthorizationRetry\(\)/);
  assert.match(app, /subscribePrivilegedAuthorizationResolved/);
  assert.match(app, /gateway\.cancelPrivilegedAuthorizationRetry\(\)/);
});

test('BUG-WFR-02 every interactive wizard RPC waits for a verified Gateway connection', () => {
  const submit = setupFlow.slice(
    setupFlow.indexOf('const submitWizardStep'),
    setupFlow.indexOf('const retryOfficialOnboarding'),
  );
  const back = setupFlow.slice(
    setupFlow.indexOf('const backOfficialOnboarding'),
    setupFlow.indexOf('const reclaimOfficialOnboarding'),
  );

  assert.match(submit, /await waitForGatewayConnection\(operationId\);[\s\S]*?\.next\(stepId, value\)/);
  assert.match(back, /await waitForGatewayConnection\(operationId\);[\s\S]*?\.back\(\)/);
});

test('BUG-WFR-04 stale wizard operations cannot commit after setup navigation or Gateway replacement', () => {
  const wizardOperations = setupFlow.slice(
    setupFlow.indexOf('const invalidateWizardOperations'),
    setupFlow.indexOf('// ── Actions ──'),
  );
  const back = setupFlow.slice(
    setupFlow.indexOf('const goBack = useCallback'),
    setupFlow.indexOf('const retryGit = useCallback'),
  );

  assert.match(wizardOperations, /wizardClientRef\.current\?\.invalidatePendingOperations\(\)/);
  assert.match(wizardOperations, /gateway\.cancelPrivilegedAuthorizationRetry\(\)/);
  assert.match(wizardOperations, /assertWizardOperationCurrent\(operationId\)/);
  assert.match(back, /invalidateWizardOperations\(\)/);
});

test('BUG-WFR-03 wizard failures are visible first and change the primary action to Retry', () => {
  const wizard = setupPage.slice(
    setupPage.indexOf('function WizardScreen'),
    setupPage.indexOf('// ── 开机自启偏好'),
  );
  const errorPosition = wizard.indexOf('{flow.wizardError && <div');
  const firstStepControl = wizard.indexOf('{feishuQrSetupMethod && (');

  assert.ok(errorPosition >= 0 && errorPosition < firstStepControl);
  assert.match(wizard, /label: flow\.wizardError[\s\S]*?setup\.wizard\.retry/);
  assert.match(wizard, /if \(flow\.wizardError\) \{[\s\S]*?flow\.retryWizard\(\)/);
  assert.match(wizard, /icon: flow\.wizardError \? "none" : "next"/);
});

test('BUG-ONB-17 setup endpoint cache removes legacy renderer Gateway credentials', () => {
  const cache = setupFlow.slice(
    setupFlow.indexOf('function cacheGatewayTarget'),
    setupFlow.indexOf('export function useSetupFlow'),
  );

  assert.match(cache, /delete next\.gatewayToken/);
  assert.doesNotMatch(cache, /next\.gatewayToken\s*=/);
});

test('BUG-ONB-24 URL-only settings changes preserve endpoint-scoped credentials', () => {
  assert.doesNotMatch(settingsStore, /setItem\(['"]aegis-gateway-token/);
  assert.match(settingsStore, /config\?\.save\?\.\(\{ gatewayUrl: url \}\)/);
  assert.match(settingsPage, /if \(tokenDirty\) setGatewayToken\(editToken\.trim\(\)\)/);
  assert.match(settingsDialog, /if \(tokenDirty\) setGatewayToken\(editToken\.trim\(\)\)/);
  assert.match(adapter, /const safe = \{ \.\.\.current, \.\.\.update \}/);
  assert.match(adapter, /delete safe\.gatewayToken/);
  assert.match(adapter, /if \(token\) await persistGatewayToken\(token,/);
});

test('BUG-ONB-05 runtime selection is explicit and confirmed by one contextual action', () => {
  const mode = setupPage.slice(
    setupPage.indexOf('function ModeSelectScreen'),
    setupPage.indexOf('function ProgressScreen'),
  );

  assert.match(mode, /aria-pressed=\{selectedMode === "native"\}[\s\S]*?setSelectedMode\("native"\)/);
  assert.match(mode, /disabled=\{!dockerAvailable\}[\s\S]*?aria-pressed=\{selectedMode === "docker"\}[\s\S]*?setSelectedMode\("docker"\)/);
  assert.match(mode, /const dockerImageAvailable = flow\.dockerStatus\?\.image_available === true/);
  assert.match(mode, /const selectedModeReady = selectedMode === "native" \? nativeInstalled : dockerImageAvailable/);
  assert.match(mode, /setup\.useRuntimeAndContinue[\s\S]*?setup\.prepareRuntimeAndContinue/);
  assert.match(mode, /label: primaryLabel[\s\S]*?flow\.selectMode\(selectedMode\)/);
  assert.doesNotMatch(mode, /flow\.selectMode\("(?:native|docker)"\)/);
});

test('BUG-ONB-36 the runtime choice presents reuse first instead of claiming every path is an install', () => {
  const mode = setupPage.slice(
    setupPage.indexOf('function ModeSelectScreen'),
    setupPage.indexOf('function ProgressScreen'),
  );
  const zh = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'));

  const detection = setupFlow.slice(
    setupFlow.indexOf('// ── 挂载后自动检测'),
    setupFlow.indexOf('// ── Docker detect after the welcome step'),
  );

  assert.match(mode, /flow\.openclawStatus\?\.installed === true/);
  assert.match(detection, /const oclaw = await checkOpenclaw\(\)/);
  assert.doesNotMatch(detection, /selectedRuntime === "native" \? await checkOpenclaw\(\) : null/);
  assert.match(mode, /setup\.nativeDetected/);
  assert.match(mode, /setup\.dockerReady/);
  assert.match(mode, /setup\.dockerImageWillPrepare/);
  assert.equal(zh.setup.modeSelectionTitle, '确认 OpenClaw 运行方式');
  assert.match(zh.setup.chooseMode, /直接复用/);
  assert.doesNotMatch(zh.setup.modeNativeDesc, /直接在您的电脑上安装/);
});

test('BUG-ONB-06 every setup message is complete in all supported locales', () => {
  const locales = Object.fromEntries(['zh', 'zh-TW', 'en', 'ar'].map((locale) => [
    locale,
    flattenMessages(JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'))),
  ])) as Record<string, Record<string, unknown>>;
  const setupKeys = Object.keys(locales.zh).filter((key) => key.startsWith('setup.'));

  for (const locale of ['en', 'ar']) {
    for (const key of setupKeys) {
      assert.equal(typeof locales[locale][key], 'string', `${locale} is missing ${key}`);
      assert.notEqual(String(locales[locale][key]).trim(), '', `${locale} has an empty ${key}`);
    }
  }
});

test('BUG-ONB-07 wizard body messages are not duplicated as subtitles', () => {
  const wizard = setupPage.slice(
    setupPage.indexOf('function WizardScreen'),
    setupPage.indexOf('function ReadyScreen'),
  );

  assert.match(wizard, /const messageRenderedInBody = presentedStep\.type === "confirm"/);
  assert.match(wizard, /subtitle=\{wizardSubtitle\}/);
  assert.match(wizard, /aria-label=\{presentedStep\.title \|\| t\("setup\.wizard\.textInput"/);
});

test('BUG-ONB-08 the product summary is not constrained to an awkward narrow line length', () => {
  const welcome = setupPage.slice(
    setupPage.indexOf('function WelcomeScreen'),
    setupPage.indexOf('function DetectingScreen'),
  );
  assert.doesNotMatch(welcome, /max-w-\[42ch\]/);
  assert.match(welcome, /min-\[520px\]:whitespace-nowrap/);
});

test('BUG-ONB-11 Back navigation returns to history instead of a hard-coded screen', () => {
  const goBack = setupFlow.slice(
    setupFlow.indexOf('const goBack = useCallback'),
    setupFlow.indexOf('const retryGit = useCallback'),
  );

  assert.match(goBack, /goBackSetup\("welcome"\)/);
  assert.doesNotMatch(goBack, /replaceSetupStep\("choosing-mode"\)/);
  assert.match(setupPage, /onBack=\{flow\.goBack\}/);
});

test('BUG-ONB-12 stopped Gateway screen uses a completed detection title', () => {
  const stopped = setupPage.slice(
    setupPage.indexOf('function GatewayStoppedScreen'),
    setupPage.indexOf('function ModeSelectScreen'),
  );

  assert.match(stopped, /setup\.openclawDetectedTitle/);
  assert.doesNotMatch(stopped, /setup\.foundOclaw/);
});

test('BUG-ONB-14 selected runtimes resume their full startup closure after storage', () => {
  const completeStorage = setupFlow.slice(
    setupFlow.indexOf('const completeStorageSetup = useCallback'),
    setupFlow.indexOf('const repairAndRetry = useCallback'),
  );

  assert.match(completeStorage, /installMode === "native"/);
  assert.match(completeStorage, /openclawStatus\?\.installed/);
  assert.match(completeStorage, /const canResumeSelectedRuntime = installMode === "docker" \|\| canResumeNativeRuntime/);
  assert.match(completeStorage, /if \(!runtimeReconfigurationRequired && canResumeSelectedRuntime\)[\s\S]*?navigateSetup\("checking", "push"\)/);
  assert.match(completeStorage, /installMode === "docker"[\s\S]*?void runDockerSetup\(\)[\s\S]*?void runNativeSetup\(\)/);
});

test('BUG-ONB-15 setup navigation has one complete six-step translation contract per locale', () => {
  const zh = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(readFileSync(new URL('../locales/ar.json', import.meta.url), 'utf8'));

  const zhExpected = {
    identity: { title: '品牌与偏好', description: '语言 / 主题' },
    environment: { title: '环境检测', description: 'OpenClaw / Docker' },
    storage: { title: '数据位置', description: '配置与工作区' },
    runtime: { title: '运行时', description: '安装并启动 Gateway' },
    configuration: { title: 'OpenClaw 配置', description: '模型、凭据与渠道' },
    ready: { title: '完成', description: '进入仪表盘' },
  };
  const enExpected = {
    identity: { title: 'Preferences', description: 'Language / Theme' },
    environment: { title: 'Environment', description: 'OpenClaw / Docker' },
    storage: { title: 'Data location', description: 'Configuration / Workspace' },
    runtime: { title: 'Runtime', description: 'Install and start Gateway' },
    configuration: { title: 'OpenClaw setup', description: 'Models / credentials / channels' },
    ready: { title: 'Ready', description: 'Enter dashboard' },
  };

  assert.deepEqual(zh.setup.steps, zhExpected);
  assert.deepEqual(en.setup.steps, enExpected);
  for (const step of Object.keys(zhExpected)) {
    assert.equal(typeof ar[`setup.steps.${step}.title`], 'string');
    assert.equal(typeof ar[`setup.steps.${step}.description`], 'string');
  }
});

test('BUG-ONB-09 terminal integration is an optional storage preference, not an install step', () => {
  const nativeSteps = setupFlow.slice(
    setupFlow.indexOf('const INITIAL_NATIVE_STEPS'),
    setupFlow.indexOf('const INITIAL_DOCKER_STEPS'),
  );
  const dockerSteps = setupFlow.slice(
    setupFlow.indexOf('const INITIAL_DOCKER_STEPS'),
    setupFlow.indexOf('function cacheGatewayTarget'),
  );

  assert.doesNotMatch(nativeSteps, /id: "terminal"/);
  assert.doesNotMatch(dockerSteps, /id: "terminal"/);
  assert.doesNotMatch(setupFlow, /configureTerminalIntegration|applyTerminalIntegration/);
  assert.match(storageGate, /checked=\{terminalIntegration\}/);
  assert.match(storageGate, /storage\.terminalIntegrationHint/);
});

test('BUG-ONB-28 a verified setup Gateway hands off without replaying cold boot', () => {
  assert.match(appStore, /WorkspaceStartupMode/);
  assert.match(setupFlow, /setWorkspaceStartupMode\("verified-gateway-handoff"\)/);
  assert.match(app, /VERIFIED_GATEWAY_HANDOFF_TIMEOUT_MS/);
  assert.match(app, /workspaceStartupMode !== 'verified-gateway-handoff'/);
  assert.match(app, /surfaceVerifiedGatewayHandoffFailure/);
  assert.match(app, /gateway\.refreshConnectionStatus\(\)/);
  assert.match(gatewayClient, /refreshConnectionStatus\(\) \{ connection\.emitStatus\(\); \}/);
});

test('BUG-ONB-29 model verification owns the active setup status after Gateway startup', () => {
  assert.match(setupFlowPanels, /export type InstallationConsoleSummary =/);
  assert.match(setupFlowPanels, /kind: "model-checking"/);
  assert.match(setupFlowPanels, /kind: "model-check-failed"; message: string/);
  assert.match(setupFlowPanels, /const showProgress = !modelChecking && !modelCheckFailed/);
  assert.match(setupPage, /const installationSummary: InstallationConsoleSummary = gatewayReadyChecking/);
  assert.match(setupPage, /summary=\{installationSummary\}/);
  assert.doesNotMatch(setupPage, /gatewayReadyChecking && \([\s\S]*?<StatusPanel/);
});

test('BUG-ONB-30 verified Gateway handoff cannot start cold recovery', () => {
  const coldRecovery = app.slice(
    app.indexOf('// During boot, separate two different failures:'),
    app.indexOf('// ── uiScale'),
  );

  assert.match(coldRecovery, /if \(workspaceStartupMode === 'verified-gateway-handoff'\) return;/);
  assert.match(coldRecovery, /workspaceStartupMode,/);
});

test('BUG-ONB-31 the explicit dashboard action lands on the dashboard', () => {
  const entry = setupFlow.slice(
    setupFlow.indexOf('const enterDashboard = useCallback'),
    setupFlow.indexOf('return {', setupFlow.indexOf('const enterDashboard = useCallback')),
  );

  assert.match(entry, /window\.location\.hash = '\/';/);
  assert.doesNotMatch(entry, /ai-workspace/);
  assert.match(setupPage, /setup\.enterDashboard/);
  assert.doesNotMatch(setupPage, /setup\.enterWorkspace/);
});

test('BUG-ONB-10 setup leaves system tools and npm cache at their native defaults', () => {
  assert.doesNotMatch(storageGate, /label=\{t\('storage\.runtimeLocation'/);
  assert.match(storageGate, /checked=\{customNpmCache\}/);
  assert.match(storageGate, /npmCacheDir: customNpmCache \? npmCacheDir\.trim\(\) \|\| null : null/);
  assert.match(storageGate, /npmCacheDir: string \| null/);
  assert.match(storageGate, /关闭时使用 npm 在当前系统和用户下的默认缓存位置/);
});

test('BUG-CPI-03 macOS missing Node runs the domestic system-installer recovery path', () => {
  assert.match(setupFlow, /let setupNode = await checkSetupNode\(\)/);
  assert.doesNotMatch(setupFlow, /useMacSystemRecovery/);
  assert.match(setupFlow, /if \(!nodeStatus\.available\)[\s\S]*?setupNode = await runDependencyInstall\([\s\S]*?installNode\(false, operationId\)/);
  assert.match(setupCommand, /install_macos_system_node/);
  assert.match(setupCommand, /Command::new\("\/usr\/bin\/open"\)/);
  assert.doesNotMatch(setupPage, /nodejs\.org/);
  assert.match(setupFlow, /const retryNode = useCallback/);
  assert.match(setupPage, /function NodeMissingScreen/);
  assert.match(setupPage, /flow\.retryNode\(\)/);
});

test('BUG-CPI-06 workspace and Gateway progress paths are resolved from storage state', () => {
  assert.match(adapter, /async function readStorageRuntimePaths/);
  assert.match(adapter, /get_storage_setup_status/);
  assert.doesNotMatch(adapter, /~\/\.openclaw/);
  assert.match(gatewayCommand, /let config_path = paths::config_path\(\)/);
  assert.match(gatewayCommand, /let meta = ConfigMetadata::load\(&config_path\)/);
});

test('BUG-GSO-02 autostart enable completes the official service handoff', () => {
  const gatewayService = readFileSync(
    new URL('../../src-tauri/src/commands/gateway_service.rs', import.meta.url),
    'utf8',
  );
  const registration = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  // The option is only offered for the Native runtime; Docker containers rely
  // on their restart policy instead of a host-level service.
  const ready = setupPage.slice(
    setupPage.indexOf('function ReadyScreen'),
    setupPage.indexOf('function GitMissingScreen'),
  );
  assert.match(setupPage, /function GatewayAutostartPreference/);
  assert.match(setupPage, /installMode !== "native" \|\| status === null \|\| status\?\.supported === false/);
  assert.match(setupPage, /setup\.runtimePreferences/);
  assert.match(ready, /<GatewayAutostartPreference[\s\S]*installMode=\{flow\.installMode\}[\s\S]*onOperationStateChange=\{setAutostartBusy\}[\s\S]*\/>/);
  assert.doesNotMatch(ready, /OpenClawUpdatePanel/);

  // Enable uses the rollback-aware official handoff; disable removes the
  // service before the existing restart path creates a managed child.
  assert.match(gatewayService, /"gateway", "install", "--force", "--port", port\.as_str\(\)/);
  assert.match(gatewayService, /"gateway", "uninstall", "--json"/);
  assert.match(gatewayService, /fn service_status_args\(\)[\s\S]*"gateway", "status", "--json", "--no-probe"/);
  assert.match(gatewayService, /OpenClawRuntimeMode::Native/);
  assert.match(setupPage, /await handoffGatewayToOfficialService\(\)/);
  assert.match(setupPage, /if \(enabled\)[\s\S]*await window\.aegis\.config\.restart\(\)/);

  // All three commands are reachable from the frontend.
  for (const command of [
    'gateway_autostart_status',
    'enable_gateway_autostart',
    'disable_gateway_autostart',
  ]) {
    assert.match(registration, new RegExp(command));
  }
});

test('BUG-ONB-18 unused prepare_gateway bridge is no longer part of the command surface', () => {
  assert.doesNotMatch(adapter, /prepareGateway/);
  assert.doesNotMatch(setupCommand, /prepare_gateway/);
});

test('BUG-ONB-21 Ready requires the official live model probe', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('if (result.done || result.status === "done")'),
    setupFlow.indexOf('const recoverLostWizardSession'),
  );
  const readyTransition = setupFlow.slice(
    setupFlow.indexOf('const continueAfterGatewayReady'),
    setupFlow.indexOf('// Gateway startup is an installation transition'),
  );

  assert.match(completion, /const modelProbe = await probeActiveRuntimeModel\(\)/);
  assert.match(completion, /if \(!modelProbe\.ready\)/);
  assert.ok(completion.indexOf('updateOnboardingRequirement(false)') > completion.indexOf('if (!modelProbe.ready)'));
  assert.match(readyTransition, /onboardingRequired = !\(await probeActiveRuntimeModel\(\)\)\.ready/);
});

test('BUG-ONB-25 lost terminal sessions reconcile observable completion before restart', () => {
  const recovery = setupFlow.slice(
    setupFlow.indexOf('const recoverLostWizardSession'),
    setupFlow.indexOf('const startOfficialOnboarding'),
  );
  assert.match(recovery, /resolveActiveRuntimeOnboardingRequirement\(\)/);
  assert.match(recovery, /probeActiveRuntimeModel\(\)/);
  assert.match(recovery, /return \{ done: true, status: "done" \}/);
  assert.ok(recovery.indexOf('return await client.start()') > recovery.indexOf('if (modelProbe.ready)'));
});

test('BUG-ONB-26 official external URL and device code remain actionable', () => {
  const wizard = setupPage.slice(
    setupPage.indexOf('function WizardScreen'),
    setupPage.indexOf('// ── 开机自启卡片'),
  );
  assert.match(wizard, /presentedStep\.externalUrl/);
  assert.match(wizard, /deviceCode\.code/);
  assert.match(wizard, /openWizardExternalUrl\(presentedStep\.externalUrl\)/);
  assert.match(setupPage, /async function openWizardExternalUrl/);
  assert.match(setupPage, /@tauri-apps\/plugin-shell/);
  assert.match(wizard, /navigator\.clipboard\.writeText/);
});

test('BUG-ONB-27 terminal QR notes render a bounded local image and use the system browser action', () => {
  const wizard = setupPage.slice(
    setupPage.indexOf('function WizardStepQrHint'),
    setupPage.indexOf('function WizardScreen'),
  );

  assert.match(wizard, /renderLocalQrDataUrl\(url\)/);
  assert.match(wizard, /openWizardExternalUrl\(url\)/);
  assert.doesNotMatch(wizard, /target="_blank"/);
  assert.match(setupPage, /extractOpenClawWizardQrUrl\(presentedStep\.message\)/);
});
