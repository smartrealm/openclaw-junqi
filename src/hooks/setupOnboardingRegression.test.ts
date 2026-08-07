import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readdirSync(new URL('./useSetupFlow/', import.meta.url))
  .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  .sort()
  .map((entry) => readFileSync(new URL(`./useSetupFlow/${entry}`, import.meta.url), 'utf8'))
  .join('\n');
// Each setup step now owns a file; read the one under assertion directly.
// The wizard session now lives in its own hook module; read it directly.
const hookFile = (name: string) =>
  readFileSync(new URL(`./useSetupFlow/${name}.ts`, import.meta.url), 'utf8');

const screen = (name: string) =>
  readFileSync(new URL(`../pages/SetupPage/${name}.tsx`, import.meta.url), 'utf8');

const setupPage = readdirSync(new URL('../pages/SetupPage/', import.meta.url))
  .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  .sort()
  .map((entry) => readFileSync(new URL(`../pages/SetupPage/${entry}`, import.meta.url), 'utf8'))
  .join('\n');
const setupFlowPanels = readFileSync(new URL('../components/setup/SetupFlowPanels.tsx', import.meta.url), 'utf8');
const storageGate = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const appStore = readFileSync(new URL('../stores/app-store.ts', import.meta.url), 'utf8');
const gatewayClient = readFileSync(new URL('../services/gateway/index.ts', import.meta.url), 'utf8');
const wizardClient = readFileSync(new URL('../services/openclawWizard.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../api/tauri-adapter.ts', import.meta.url), 'utf8');
const settingsStore = readFileSync(new URL('../stores/settingsStore.ts', import.meta.url), 'utf8');
const settingsPage = readFileSync(new URL('../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const notificationService = readFileSync(new URL('../services/notifications.ts', import.meta.url), 'utf8');
const setupCommand = readdirSync(new URL('../../src-tauri/src/commands/setup/', import.meta.url))
  .filter((entry) => entry.endsWith('.rs'))
  .sort()
  .map((entry) => readFileSync(new URL(`../../src-tauri/src/commands/setup/${entry}`, import.meta.url), 'utf8'))
  .join('\n');
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
  const detection = hookFile('useSetupEnvironmentReview');

  assert.match(detection, /const runId = beginRun\(\)/);
  assert.match(detection, /const cancelled = \(\) => !isRunActive\(runId\) \|\| navigationLeavingRef\.current/);
  assert.match(detection, /await detectGatewayConfig\(\);\s*if \(cancelled\(\)\) return null/);
  assert.match(detection, /const openclaw = await checkOpenclaw\(\);\s*if \(cancelled\(\)\) return null/);
  assert.doesNotMatch(setupFlow, /window\.aegis\.config\.detect/);
  assert.match(detection, /const next = await detectEnvironment\(runId\);[\s\S]*?!isRunActive\(runId\)[\s\S]*?navigateSetup\("environment-review", "replace"\)/);
});

test('BUG-ONB-16 wizard completion requires authenticated post-handoff Gateway readiness', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('if (result.done || result.status === "done")'),
    setupFlow.indexOf('const startOfficialOnboarding = useCallback'),
  );

  assert.match(completion, /await handoffGatewayToOfficialService\(\)/);
  assert.match(setupFlow, /GATEWAY_HANDOFF_CONNECTION_TIMEOUT_MS = 120_000/);
  assert.match(completion, /waitForGatewayConnection\(operationId, GATEWAY_HANDOFF_CONNECTION_TIMEOUT_MS\)/);
  assert.match(completion, /await probeSelectedGateway\(\)/);
  assert.match(completion, /verification\.status === "unavailable"/);
  assert.match(completion, /setup\.wizard\.inferenceVerificationUnavailable/);
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
  const wizardHook = hookFile('useWizardSession');
  const clientSetup = wizardHook.slice(wizardHook.indexOf('new OpenClawWizardClient'));
  const failure = wizardHook.slice(
    wizardHook.indexOf('const wizardFailureMessage'),
    wizardHook.indexOf('const invalidateWizardOperations'),
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

test('BUG-ONB-34 a failed cached installation validation blocks Gateway recovery', () => {
  const healthGate = app.slice(
    app.indexOf('// The local marker is only a cache.'),
    app.indexOf("useEffect(() => {\n    const updateRoutePath"),
  );

  assert.match(healthGate, /validateCachedSetupInstallation\(\)/);
  assert.doesNotMatch(healthGate, /invoke<boolean>\(['"]probe_selected_gateway['"]/);
  assert.match(healthGate, /setSetupComplete\(null\)/);
  assert.match(healthGate, /navigateSetup\(['"]detecting['"], ['"]replace['"]\)/);
});

test('BUG-ONB-37 dashboard completion revalidates Gateway and config before committing the setup marker', () => {
  const entry = setupFlow.slice(
    setupFlow.indexOf('const enterDashboard = useCallback'),
    setupFlow.indexOf('const detectDocker = useCallback'),
  );

  assert.match(entry, /validateSetupCompletion\(\{/);
  assert.match(entry, /probeGateway: \(\) => probeSelectedGateway\(\)\.catch\(\(\) => false\)/);
  assert.match(entry, /requiresOnboarding: resolveActiveRuntimeOnboardingRequirement/);
  assert.doesNotMatch(entry, /probeModel|probeActiveRuntimeModel/);
  assert.ok(entry.indexOf('validateSetupCompletion') < entry.indexOf('setSetupComplete(true)'));
  assert.match(entry, /replaceSetupStep\("gateway-stopped"\)/);
  assert.match(entry, /replaceSetupStep\("configure-openclaw"\)/);
  assert.match(entry, /completion\.reason === "inference-verification-unavailable"/);
  assert.match(entry, /replaceSetupStep\("gateway-ready"\)/);
  assert.match(entry, /dashboardEntryInFlightRef\.current/);
});

test('BUG-PAIR-03 Ready entry is not blocked by background autostart preference work', () => {
  const readyFile = screen('ReadyScreen');
  const ready = readyFile.slice(readyFile.indexOf('function ReadyScreen'));
  const autostart = readyFile.slice(
    readyFile.indexOf('function GatewayAutostartPreference'),
    readyFile.indexOf('function ReadyScreen'),
  );

  assert.match(autostart, /onOperationStateChange\(busy\)/);
  assert.match(ready, /const blockNavigation = flow\.enteringDashboard/);
  assert.match(ready, /disabled: blockNavigation \|\| gatewayAutostartBusy \|\| appAutostartBusy/);
  const nextAction = ready.slice(ready.indexOf('nextAction={{'), ready.indexOf('>\n      <div'));
  assert.match(nextAction, /disabled: blockNavigation/);
  assert.doesNotMatch(nextAction, /gatewayAutostartBusy|appAutostartBusy/);
});

test('autostart preferences use one stable switch row while status is loading or changing', () => {
  const readyFile = screen('ReadyScreen');

  assert.match(readyFile, /import \{ AutostartPreferenceRow \}/);
  assert.ok((readyFile.match(/<AutostartPreferenceRow\.Skeleton/g) ?? []).length >= 2);
  assert.ok((readyFile.match(/<AutostartPreferenceRow/g) ?? []).length >= 4);
  assert.doesNotMatch(readyFile, /<SettingsSwitch/);
});

test('notification permission is never requested by onboarding', () => {
  assert.doesNotMatch(app, /requestPermission/);
  assert.match(settingsPage, /notifications\.testSystemNotification/);
  assert.match(notificationService, /requestPermission/);
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

  assert.match(submit, /await waitForGatewayConnection\(operationId\);[\s\S]*?\.next\(stepId, value\)/);
  assert.doesNotMatch(setupFlow, /\.back\(\)/);
});

test('BUG-WFR-04 stale wizard operations cannot commit after setup navigation or Gateway replacement', () => {
  const wizardOperations = hookFile('useWizardSession');
  const back = setupFlow.slice(
    setupFlow.indexOf('const performGoBack = useCallback'),
    setupFlow.indexOf('const retryGit = useCallback'),
  );

  assert.match(wizardOperations, /wizardClientRef\.current\?\.invalidatePendingOperations\(\)/);
  assert.match(wizardOperations, /gateway\.cancelActivePrivilegedRequest\(\)/);
  assert.match(wizardOperations, /assertWizardOperationCurrent\(operationId\)/);
  assert.match(back, /invalidateWizardOperations\(\)/);
});

test('BUG-ONB-49 wizard recovery is bounded, status-aware, and keeps healthy transport', () => {
  const wizardOperations = hookFile('useWizardSession');
  const waitForConnection = wizardOperations.slice(
    wizardOperations.indexOf('const waitForGatewayConnection'),
    wizardOperations.indexOf('const wizardFailureMessage'),
  );
  const resume = wizardClient.slice(
    wizardClient.indexOf('async resume()'),
    wizardClient.indexOf('async back()'),
  );

  assert.match(resume, /callGateway\('wizard\.status'/);
  assert.ok(resume.indexOf("callGateway('wizard.status'") < resume.indexOf("callGateway('wizard.next'"));
  assert.doesNotMatch(wizardClient, /timeoutMs:\s*null/);
  assert.doesNotMatch(waitForConnection, /gatewayManager\.reconnect\(\)/);
  assert.match(wizardOperations, /setup\.wizard\.connectingGateway/);
  assert.match(wizardOperations, /setup\.wizard\.inspectingSession/);
  assert.match(wizardOperations, /setup\.wizard\.startingSession/);
});

test('BUG-WFR-03 wizard failures are visible first and change the primary action to Retry', () => {
  const wizard = screen('WizardScreen');
  const errorPosition = wizard.indexOf('{flow.wizardError && <div');
  const firstStepControl = wizard.indexOf('{presentedStep.type === "text" && (');

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
  assert.match(settingsStore, /localStorage\.setItem\('aegis-gateway-url', url\)/);
  assert.match(settingsStore, /resolveGatewayCredentialRuntimeKey/);
  assert.match(settingsStore, /storeGatewayDeviceCredential\(runtimeKey, normalized\)/);
  assert.match(settingsPage, /if \(tokenDirty\) setGatewayToken\(editToken\.trim\(\)\)/);
  assert.doesNotMatch(adapter, /gatewayToken/);
});

test('BUG-ONB-05 runtime selection is explicit and confirmed by one contextual action', () => {
  const mode = screen('ModeSelectScreen');

  assert.match(mode, /aria-pressed=\{selectedMode === "native"\}[\s\S]*?setSelectedMode\("native"\)/);
  assert.match(mode, /disabled=\{!dockerAvailable\}[\s\S]*?aria-pressed=\{selectedMode === "docker"\}[\s\S]*?setSelectedMode\("docker"\)/);
  assert.match(mode, /const dockerImageAvailable = flow\.dockerStatus\?\.image_available === true/);
  assert.match(mode, /const selectedModeReady = selectedMode === "native" \? nativeInstalled : dockerImageAvailable/);
  assert.match(mode, /setup\.useRuntimeAndContinue[\s\S]*?setup\.prepareRuntimeAndContinue/);
  assert.match(mode, /const submitSelection[\s\S]*?flow\.selectMode\(selectedMode\)[\s\S]*?label: primaryLabel[\s\S]*?submitSelection\(\)/);
  assert.doesNotMatch(mode, /flow\.selectMode\("(?:native|docker)"\)/);
});

test('BUG-ONB-36 the runtime choice presents reuse first instead of claiming every path is an install', () => {
  const mode = screen('ModeSelectScreen');
  const zh = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'));

  const detection = hookFile('useSetupEnvironmentReview');

  assert.match(mode, /flow\.openclawStatus\?\.installed === true/);
  assert.match(detection, /const openclaw = await checkOpenclaw\(\)/);
  assert.doesNotMatch(detection, /runtime === "native" \? await checkOpenclaw\(\) : null/);
  assert.match(mode, /setup\.nativeDetected/);
  assert.match(mode, /setup\.dockerReady/);
  assert.match(mode, /setup\.dockerImageWillPrepare/);
  assert.equal(zh.setup.modeSelectionTitle, '确认 OpenClaw 运行方式');
  assert.match(zh.setup.chooseMode, /直接复用/);
  assert.doesNotMatch(zh.setup.modeNativeDesc, /直接在您的电脑上安装/);
});

test('BUG-ONB-06 every setup message is complete in all supported locales', () => {
  const locales = Object.fromEntries(['zh', 'zh-TW', 'en'].map((locale) => [
    locale,
    flattenMessages(JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'))),
  ])) as Record<string, Record<string, unknown>>;
  const setupKeys = Object.keys(locales.zh).filter((key) => key.startsWith('setup.'));

  for (const locale of ['en', 'zh-TW']) {
    for (const key of setupKeys) {
      assert.equal(typeof locales[locale][key], 'string', `${locale} is missing ${key}`);
      assert.notEqual(String(locales[locale][key]).trim(), '', `${locale} has an empty ${key}`);
    }
  }
});

test('BUG-ONB-07 wizard body messages are not duplicated as subtitles', () => {
  const wizard = screen('WizardScreen');

  assert.match(wizard, /const messageRenderedInBody = presentedStep\.type !== "text"/);
  assert.match(wizard, /&& presentedStep\.type !== "confirm"/);
  assert.match(wizard, /subtitle=\{wizardSubtitle\}/);
  assert.match(wizard, /aria-label=\{presentedStep\.title \|\| t\("setup\.wizard\.textInput"/);
});

test('BUG-ONB-08 the product summary is not constrained to an awkward narrow line length', () => {
  const welcome = screen('WelcomeScreen');
  assert.doesNotMatch(welcome, /max-w-\[42ch\]/);
  assert.match(welcome, /min-\[520px\]:whitespace-nowrap/);
});

test('BUG-ONB-11 Back navigation returns to history instead of a hard-coded screen', () => {
  const goBack = setupFlow.slice(
    setupFlow.indexOf('const performGoBack = useCallback'),
    setupFlow.indexOf('const retryGit = useCallback'),
  );

  assert.match(goBack, /goBackSetup\("welcome"\)/);
  assert.doesNotMatch(goBack, /replaceSetupStep\("choosing-mode"\)/);
  assert.match(setupPage, /onBack=\{flow\.goBack\}/);
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

test('BUG-ONB-15 setup navigation has one complete five-step translation contract per locale', () => {
  const zh = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'));
  const zhTW = JSON.parse(readFileSync(new URL('../locales/zh-TW.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));

  const zhExpected = {
    environment: { title: '环境检测', description: 'OpenClaw / Docker' },
    storage: { title: '数据位置', description: '配置与工作区' },
    runtime: { title: '运行时', description: '安装并启动 Gateway' },
    configuration: { title: 'OpenClaw 配置', description: '模型、凭据与渠道' },
    ready: { title: '完成', description: '进入仪表盘' },
  };
  const enExpected = {
    environment: { title: 'Environment', description: 'OpenClaw / Docker' },
    storage: { title: 'Data location', description: 'Configuration / Workspace' },
    runtime: { title: 'Runtime', description: 'Install and start Gateway' },
    configuration: { title: 'OpenClaw setup', description: 'Models / credentials / channels' },
    ready: { title: 'Ready', description: 'Enter dashboard' },
  };

  assert.deepEqual(zh.setup.steps, zhExpected);
  assert.deepEqual(en.setup.steps, enExpected);
  assert.deepEqual(Object.keys(zhTW.setup.steps), Object.keys(zhExpected));
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
  assert.match(setupFlow, /if \(!nodeStatus\.available\)[\s\S]*?setupNode = await runSetupOperation\([\s\S]*?installNode\(false, operationId\)/);
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
  const readyFile = screen('ReadyScreen');
  const ready = readyFile.slice(readyFile.indexOf('function ReadyScreen'));
  assert.match(setupPage, /function GatewayAutostartPreference/);
  assert.match(setupPage, /installMode !== "native" \|\| status === null \|\| status\?\.supported === false/);
  assert.match(setupPage, /setup\.runtimePreferences/);
  assert.match(ready, /<AutostartPreferences[\s\S]*installMode=\{flow\.installMode\}[\s\S]*onGatewayOperationStateChange=\{setGatewayAutostartBusy\}[\s\S]*onAppOperationStateChange=\{setAppAutostartBusy\}[\s\S]*\/>/);
  assert.doesNotMatch(ready, /OpenClawUpdatePanel/);

  // Enable uses the rollback-aware official handoff; disable removes the
  // service before the existing restart path creates a managed child.
  assert.match(gatewayService, /"gateway", "install", "--force", "--port", port\.as_str\(\)/);
  assert.match(gatewayService, /"gateway", "uninstall", "--json"/);
  assert.match(gatewayService, /fn service_status_args\(\)[\s\S]*"gateway", "status", "--json", "--no-probe"/);
  assert.match(gatewayService, /OpenClawRuntimeMode::Native/);
  assert.match(setupPage, /await handoffGatewayToOfficialService\(\)/);
  assert.match(setupPage, /if \(enabled\)[\s\S]*gatewayLifecycle\.restart\("setup-autostart-disabled"\)/);

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

test('BUG-ONB-21 Ready follows the native Gateway and configuration gates', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('if (result.done || result.status === "done")'),
    setupFlow.indexOf('const recoverLostWizardSession'),
  );
  const readyTransition = setupFlow.slice(
    setupFlow.indexOf('const continueAfterGatewayReady'),
    setupFlow.indexOf('// Gateway startup is an installation transition'),
  );

  assert.doesNotMatch(completion, /probeActiveRuntimeModel|modelNotReady/);
  assert.match(completion, /updateOnboardingRequirement\(false\)/);
  assert.doesNotMatch(readyTransition, /probeActiveRuntimeModel|probeModel/);
});

test('BUG-ONB-25 lost terminal sessions reconcile observable completion before restart', () => {
  const recovery = setupFlow.slice(
    setupFlow.indexOf('const recoverLostWizardSession'),
    setupFlow.indexOf('const startOfficialOnboarding'),
  );
  assert.match(recovery, /resolveActiveRuntimeOnboardingRequirement\(\)/);
  assert.doesNotMatch(recovery, /probeActiveRuntimeModel/);
  assert.match(recovery, /return \{ done: true, status: "done" \}/);
  assert.ok(recovery.indexOf('return await client.start()') > recovery.indexOf('if \(!structurallyIncomplete\)'));
});

test('BUG-IW-04 wizard presentation stays within the installed strict schema', () => {
  const wizard = screen('WizardScreen');
  assert.match(wizard, /presentedStep\.externalUrl/);
  assert.match(wizard, /presentedStep\.deviceCode/);
  assert.match(wizardClient, /externalUrl.*deviceCode/);
  // The step type set stays closed; only its expression moved to a constant.
  assert.match(wizardClient, /WIZARD_STEP_TYPES = \[/);
  assert.match(wizardClient, /WIZARD_STEP_TYPES as readonly string\[\]\)\.includes\(raw\.type\)/);
  // Unknown keys are dropped by projection rather than reaching the UI.
  assert.match(wizardClient, /for \(const key of WIZARD_STEP_KEYS\)/);
  assert.match(setupPage, /function WizardAuthorizationHint/);
  assert.match(setupPage, /@tauri-apps\/plugin-shell/);
});

test('BUG-ONB-27 官方授权字段通过桌面 Shell 呈现', () => {
  const wizardFile = screen('WizardScreen');
  const wizard = wizardFile.slice(
    wizardFile.indexOf('function WizardAuthorizationHint'),
    wizardFile.indexOf('function WizardScreen'),
  );

  assert.match(wizard, /openWizardExternalUrl\(externalUrl\)/);
  assert.match(wizard, /deviceCode\.code/);
  assert.doesNotMatch(wizard, /target="_blank"/);
  assert.doesNotMatch(setupPage, /openclawWizardQr|openclawTerminalQr|getGatewayLogs/);
  assert.match(setupPage, /<WizardAuthorizationHint/);
});

test('BUG-ONB-41 授权呈现只依赖官方结构化字段', () => {
  const wizardService = readFileSync(new URL('../services/openclawWizard.ts', import.meta.url), 'utf8');

  assert.match(wizardService, /isWizardDeviceCode/);
  assert.match(wizardService, /isWizardConfiguredAccount/);
  assert.match(wizardService, /WIZARD_STEP_TYPES as readonly string\[\]\)\.includes\(raw\.type\)/);
  assert.match(wizardService, /for \(const key of WIZARD_STEP_KEYS\)/);
  assert.match(setupPage, /WizardAuthorizationHint/);
});

test('BUG-ONB-42 授权步骤不因文本内容自动推进', () => {
  const wizard = screen('WizardScreen');
  const submit = wizard.slice(
    wizard.indexOf('const submitCurrentStep = async'),
    wizard.indexOf('return (', wizard.indexOf('const submitCurrentStep = async')),
  );

  assert.match(submit, /await flow\.submitWizardStep\(step\.id, value\)/);
  assert.doesNotMatch(submit, /continueOpenClawWizardQrAuthorization|wizardScanQrUrl/);
});

test('BUG-ONB-40 official Gateway finalizer refreshes credentials and reconciles its lost wizard session', () => {
  assert.match(setupFlow, /getGatewayToken\(\)\.catch\(\(\) => target\.token/);
  assert.match(setupFlow, /getGatewayDeviceCredentialForUrl\(gatewayWsUrl\)/);
  assert.match(setupFlow, /gatewayManager\.connect\(gatewayWsUrl, token, deviceToken\)/);
  assert.match(setupFlow, /const recoverAfterGatewayHandoff/);
  assert.match(setupFlow, /return await recoverLostWizardSession\(client\)/);
  assert.match(setupFlow, /error instanceof GatewayPrivilegedSourceChangedError/);
});

test('BUG-ONB-45 a terminal note survives the final Gateway restart without a false timeout', () => {
  const wizardHook = hookFile('useWizardSession');
  const submit = wizardHook.slice(
    wizardHook.indexOf('const submitWizardStep'),
    wizardHook.indexOf('const retryOfficialOnboarding'),
  );
  const wizard = screen('WizardScreen');

  assert.match(submit, /connectionTimedOut/);
  assert.match(submit, /OpenClawWizardGatewayConnectionTimeoutError/);
  assert.match(submit, /isOpenClawWizardCompletionStep\(wizardClientRef\.current\?\.currentStepView\)/);
  assert.match(submit, /resolveActiveRuntimeOnboardingRequirement\(\)/);
  assert.match(submit, /applyWizardResult\(\{ done: true, status: "done" \}, operationId\)/);
  assert.match(wizard, /isOpenClawWizardNonBlockingProbeFailure\(presentedStep\)/);
  assert.match(wizard, /setup\.wizard\.nonBlockingProbeFailure/);
  assert.match(wizard, /setup\.wizard\.completionVerification/);
});

test('BUG-ONB-50 retry recovers an upstream-reaped Wizard session instead of surfacing wizard not found', () => {
  const wizardHook = hookFile('useWizardSession');
  const retry = wizardHook.slice(
    wizardHook.indexOf('const retryOfficialOnboarding'),
    wizardHook.indexOf('const pollOfficialOnboarding'),
  );

  assert.match(retry, /wizardClientRef\.current!\.retry\(\)/);
  assert.match(retry, /isOpenClawWizardSessionLost\(error\)/);
  assert.match(retry, /recoverLostWizardSession\(wizardClientRef\.current!\)/);
});

test('BUG-ONB-46 Gateway 执行的进度步骤只由官方会话轮询', () => {
  const wizard = screen('WizardScreen');
  const wizardHook = hookFile('useWizardSession');

  assert.match(wizard, /step\?\.type === "progress" && step\.executor === "gateway"/);
  assert.match(wizard, /autoPolledProgressStepRef\.current === step\.id/);
  assert.match(wizard, /void flow\.pollWizard\(\)/);
  assert.match(wizardHook, /pollWizard: pollOfficialOnboarding/);
  assert.doesNotMatch(wizard, /terminalQrCaptureActive|terminalQrFallback|wizardScanQrUrl/);
});

test('a superseded wizard submit releases its re-entry guard', () => {
  // 向导提交期间允许在错误状态下重试；接管操作必须同步释放旧提交的所有权，
  // 否则旧请求的 finally 不会清理守卫，后续向导操作会永久失去响应。
  assert.match(setupPage, /disabled: flow\.wizardSubmitting && !flow\.wizardError/);
  assert.match(
    setupFlow,
    /const beginWizardOperation = useCallback\(\(\) => \{[\s\S]*?wizardSubmitInFlightRef\.current = false;[\s\S]*?return operationId;/,
  );
  // The shared navigation guard is read before takeover, so Next and Back
  // cannot supersede one another before React commits the loading state.
  assert.match(
    setupFlow,
    /if \(wizardNavigationInFlightRef\.current\) return null;\s*\n\s*const operationId = beginWizardOperation\(\);\s*\n\s*wizardSubmitInFlightRef\.current = true;\s*\n\s*wizardNavigationInFlightRef\.current = "next";/,
  );
});

test('wizard submission has a synchronous navigation gate without simulated Back', () => {
  assert.match(setupFlow, /const wizardNavigationInFlightRef = useRef<"next" \| null>\(null\)/);
  assert.doesNotMatch(setupFlow, /backOfficialOnboarding|\.back\(\)|canGoBack/);
  assert.match(
    setupFlow,
    /const submitWizardStep[\s\S]*?if \(wizardNavigationInFlightRef\.current\) return null;[\s\S]*?wizardNavigationInFlightRef\.current = "next";/,
  );
  assert.match(
    setupFlow,
    /const invalidateWizardOperations[\s\S]*?wizardNavigationInFlightRef\.current = null;[\s\S]*?invalidatePendingOperations/,
  );
});

test('wizard recovery actions are synchronous single-flight before React commits loading state', () => {
  // React state cannot guard two clicks delivered before its next render.
  // Retry and reclaim therefore share one synchronous recovery guard and also
  // refuse to race an active wizard navigation operation.
  assert.match(setupFlow, /const wizardRecoveryInFlightRef = useRef<"retry" \| "reclaim" \| null>\(null\)/);
  assert.match(
    setupFlow,
    /const beginWizardOperation = useCallback\(\(\) => \{[\s\S]*?wizardRecoveryInFlightRef\.current = null;[\s\S]*?return operationId;/,
  );
  assert.match(
    setupFlow,
    /const retryOfficialOnboarding[\s\S]*?if \(wizardRecoveryInFlightRef\.current \|\| wizardNavigationInFlightRef\.current\) return null;\s*\n\s*const operationId = beginWizardOperation\(\);\s*\n\s*wizardRecoveryInFlightRef\.current = "retry";[\s\S]*?finally \{\s*\n\s*if \(wizardOperationRef\.current === operationId\) \{\s*\n\s*wizardRecoveryInFlightRef\.current = null;/,
  );
  assert.match(
    setupFlow,
    /const reclaimOfficialOnboarding[\s\S]*?if \(wizardRecoveryInFlightRef\.current \|\| wizardNavigationInFlightRef\.current\) return null;\s*\n\s*const operationId = beginWizardOperation\(\);\s*\n\s*wizardRecoveryInFlightRef\.current = "reclaim";[\s\S]*?finally \{\s*\n\s*if \(wizardOperationRef\.current === operationId\) \{\s*\n\s*wizardRecoveryInFlightRef\.current = null;/,
  );
  assert.match(
    setupFlow,
    /const invalidateWizardOperations[\s\S]*?wizardRecoveryInFlightRef\.current = null;[\s\S]*?invalidatePendingOperations/,
  );
});

test('environment review distinguishes Docker installation from daemon readiness', () => {
  const review = screen('EnvironmentReviewScreen');
  const redetect = hookFile('useSetupEnvironmentReview');

  assert.match(review, /const dockerInstalled = flow\.dockerStatus\?\.available === true/);
  assert.match(review, /const dockerReady = dockerInstalled && flow\.dockerStatus\?\.daemon_running === true/);
  assert.match(review, /setup\.dockerRunning/);
  assert.match(review, /setup\.dockerInstalledStopped/);
  assert.match(review, /setup\.dockerNotDetected/);
  assert.match(review, /loading: flow\.checkingDocker/);
  assert.match(review, /disabled: flow\.checkingDocker/);
  assert.match(review, /setup\.recheckingEnvironmentHint/);
  assert.match(redetect, /detectEnvironment\(runId\)/);
  assert.doesNotMatch(redetect, /navigateSetup\("detecting", "replace"\)/);
});

test('BUG-ONB-44 shared setup logs are visible only when diagnostics exist', () => {
  assert.match(setupFlowPanels, /isRuntime && showLogToggle && logs\.length > 0/);
  assert.match(setupFlowPanels, /disabled=\{!logText\}/);
  assert.match(screen('ProgressScreen'), /<InstallationConsole/);
});
