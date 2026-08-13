import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { shouldDeferColdGatewayRecovery } from '@/stores/app-store';

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
const notificationService = readFileSync(new URL('../runtime/notifications.ts', import.meta.url), 'utf8');
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
  assert.match(detection, /settleInitialEnvironmentDetection\([\s\S]*?detectEnvironment\(runId\)[\s\S]*?checkDocker\(\)[\s\S]*?!isRunActive\(runId\)[\s\S]*?navigateSetup\("environment-review", "replace"\)/);
});

test('BUG-ONB-34 cached setup defers cold recovery until durable installation validation settles', () => {
  assert.ok(
    (app.match(/if \(cachedSetupValidationPending\) return;/g) ?? []).length >= 2,
    'cold recovery and Gateway callback registration must wait for cached setup validation',
  );
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

test('BUG-ONB-37 dashboard completion revalidates Gateway and the current terminal gate before committing the setup marker', () => {
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

test('BUG-ONB-49 wizard recovery avoids destructive status reads and lets authorization own its timeout', () => {
  const wizardOperations = hookFile('useWizardSession');
  const waitForConnection = wizardOperations.slice(
    wizardOperations.indexOf('const waitForGatewayConnection'),
    wizardOperations.indexOf('const wizardFailureMessage'),
  );
  const resume = wizardClient.slice(
    wizardClient.indexOf('async resume('),
    wizardClient.indexOf('async retry('),
  );
  const next = wizardClient.slice(
    wizardClient.indexOf('async next('),
    wizardClient.indexOf('async resume()'),
  );

  assert.doesNotMatch(resume, /callGateway\('wizard\.status'/);
  assert.match(resume, /callGateway\('wizard\.next'/);
  assert.match(next, /timeoutMs:\s*null/);
  assert.doesNotMatch(waitForConnection, /gatewayManager\.reconnect\(\)/);
  assert.match(wizardOperations, /setup\.wizard\.connectingGateway/);
  assert.match(wizardOperations, /setup\.wizard\.inspectingSession/);
  assert.match(wizardOperations, /setup\.wizard\.startingSession/);
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
  assert.match(mode, /aria-pressed=\{selectedMode === "docker"\}[\s\S]*?setSelectedMode\("docker"\)/);
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

  assert.match(wizard, /isWizardBodyMessageStep\(presentedStep\.type\)/);
  assert.match(wizard, /WizardStepRenderer/);
  assert.match(wizard, /subtitle=\{wizardSubtitle\}/);
  const textStep = readFileSync(new URL('../pages/SetupPage/wizard/WizardTextStep.tsx', import.meta.url), 'utf8');
  assert.match(textStep, /aria-label=\{step\.title \|\| t\("setup\.wizard\.textInput"/);
});

test('BUG-ONB-08 the product summary is not constrained to an awkward narrow line length', () => {
  const welcome = screen('EnvironmentEntryScreen');
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
    configuration: { title: 'OpenClaw 配置', description: '模型、凭据与可选消息渠道' },
    ready: { title: '完成', description: '进入仪表盘' },
  };
  const enExpected = {
    environment: { title: 'Environment', description: 'OpenClaw / Docker' },
    storage: { title: 'Data location', description: 'Configuration / Workspace' },
    runtime: { title: 'Runtime', description: 'Install and start Gateway' },
    configuration: { title: 'OpenClaw setup', description: 'Models / credentials / optional channels' },
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

test('BUG-ONB-29 Gateway 核验与官方配置向导共享同一配置呈现容器', () => {
  const configurationScreen = screen('OpenClawConfigurationScreen');

  assert.match(setupPage, /case "gateway-ready": return <OpenClawConfigurationScreen/);
  assert.match(setupPage, /case "configure-openclaw": return <OpenClawConfigurationScreen/);
  assert.match(configurationScreen, /<WizardScreen flow=\{flow\} logs=\{logs\} \/>/);
  assert.match(configurationScreen, /void flow\.continueAfterGatewayReady\(\)/);
  assert.match(configurationScreen, /setup\.gatewayReadyCheckAction/);
  assert.match(configurationScreen, /setup\.gatewayReadyRetryAction/);
});

test('BUG-ONB-30 verified Gateway handoff cannot start cold recovery', () => {
  assert.equal(shouldDeferColdGatewayRecovery('verified-gateway-handoff'), true);
  assert.equal(shouldDeferColdGatewayRecovery('cold'), false);
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
  assert.match(setupPage, /installMode !== "native" \|\| status === null \|\| status\.supported === false/);
  assert.match(setupPage, /setup\.runtimePreferences/);
  assert.match(setupPage, /Promise\.all\(\[gatewayRequest, appRequest\]\)/);
  assert.match(setupPage, /const loading = gatewayStatus === undefined \|\| appStatus === undefined/);
  assert.match(setupPage, /loading \? \([\s\S]*AutostartPreferenceRow\.Skeleton/);
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

test('BUG-ONB-21 Ready follows the native Gateway and current official terminal gates', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('const completeWizardRuntime = useCallback'),
    setupFlow.indexOf('const applyWizardResult = useCallback'),
  );
  const readyTransition = setupFlow.slice(
    setupFlow.indexOf('const continueAfterGatewayReady'),
    setupFlow.indexOf('// Gateway startup is an installation transition'),
  );

  assert.doesNotMatch(completion, /probeActiveRuntimeModel|modelNotReady/);
  assert.match(completion, /updateOnboardingRequirement\(false\)/);
  assert.doesNotMatch(readyTransition, /probeActiveRuntimeModel|probeModel/);
});

test('BUG-IW-04 wizard presentation stays within the installed strict schema', () => {
  const authorization = readFileSync(new URL('../pages/SetupPage/wizard/WizardAuthorizationHint.tsx', import.meta.url), 'utf8');
  assert.match(authorization, /externalUrl/);
  assert.match(authorization, /deviceCode/);
  assert.match(wizardClient, /externalUrl.*deviceCode/);
  // 步骤类型集合保持封闭，仅将其表达式抽取为常量。
  assert.match(wizardClient, /WIZARD_STEP_TYPES = \[/);
  assert.match(wizardClient, /WIZARD_STEP_TYPES as readonly string\[\]\)\.includes\(raw\.type\)/);
  // 未知字段必须在投影阶段丢弃，不能进入界面层。
  assert.match(wizardClient, /for \(const key of WIZARD_STEP_KEYS\)/);
  assert.match(authorization, /@tauri-apps\/plugin-shell/);
});

test('BUG-ONB-27 官方授权字段通过桌面 Shell 呈现', () => {
  const wizard = readFileSync(new URL('../pages/SetupPage/wizard/WizardAuthorizationHint.tsx', import.meta.url), 'utf8');

  assert.match(wizard, /deviceCode\.code/);
  assert.doesNotMatch(wizard, /target="_blank"/);
  assert.doesNotMatch(setupPage, /openclawWizardQr|openclawTerminalQr|getGatewayLogs/);
  assert.match(wizard, /<button/);
});

test('BUG-ONB-41 授权呈现只依赖官方结构化字段', () => {
  const wizardService = readFileSync(new URL('../services/openclawWizard.ts', import.meta.url), 'utf8');
  const authorization = readFileSync(new URL('../pages/SetupPage/wizard/WizardAuthorizationHint.tsx', import.meta.url), 'utf8');

  assert.match(wizardService, /isWizardDeviceCode/);
  assert.match(wizardService, /isWizardConfiguredAccount/);
  assert.match(wizardService, /WIZARD_STEP_TYPES as readonly string\[\]\)\.includes\(raw\.type\)/);
  assert.match(wizardService, /for \(const key of WIZARD_STEP_KEYS\)/);
  assert.match(authorization, /externalUrl/);
  assert.match(authorization, /deviceCode/);
});

test('BUG-ONB-42 授权步骤不因文本内容自动推进', () => {
  const wizard = screen('WizardScreen');
  const submit = wizard.slice(
    wizard.indexOf('const submitCurrentStep = async'),
    wizard.indexOf('return (', wizard.indexOf('const submitCurrentStep = async')),
  );

  assert.match(submit, /await wizard\.submitWizardStep\(step\.id, value\)/);
  assert.doesNotMatch(submit, /continueOpenClawWizardQrAuthorization|wizardScanQrUrl/);
});

test('BUG-ONB-40 lost Wizard sessions retain an unknown terminal state without replay', () => {
  const wizardHook = hookFile('useWizardSession');
  const recovery = wizardHook.slice(
    wizardHook.indexOf('const reconcileLostWizardSession'),
    wizardHook.indexOf('const recoverAfterGatewayHandoff'),
  );

  assert.match(setupFlow, /getGatewayToken\(\)\.catch\(\(\) => target\.token/);
  assert.match(setupFlow, /getGatewayDeviceCredentialForUrl\(gatewayWsUrl\)/);
  assert.match(setupFlow, /gatewayManager\.connect\(gatewayWsUrl, token, deviceToken\)/);
  assert.match(setupFlow, /const recoverAfterGatewayHandoff/);
  assert.match(recovery, /reconcileWizardSessionLoss/);
  assert.match(recovery, /terminal-unknown/);
  assert.doesNotMatch(recovery, /resolveOnboardingRequirement|\.start\(|restartAfterSessionLoss|status: "done"/);
  assert.match(setupFlow, /error instanceof GatewayPrivilegedSourceChangedError/);
});

test('BUG-ONB-50 retry does not infer completion for an upstream-reaped Wizard session', () => {
  const wizardHook = hookFile('useWizardSession');
  const retry = wizardHook.slice(
    wizardHook.indexOf('const retryOfficialOnboarding'),
    wizardHook.indexOf('const pollOfficialOnboarding'),
  );

  assert.match(retry, /recoveryMode === "session"/);
  assert.match(retry, /recoveryMode === "terminal-unknown"/);
  assert.match(retry, /isOpenClawWizardSessionLost\(error\)/);
  assert.match(retry, /reconcileLostWizardSession\(operationId\)/);
  assert.doesNotMatch(retry, /restartAfterSessionLoss/);
  assert.match(retry, /recoveryMode === "runtime"[\s\S]*?completeWizardRuntime\(operationId\)/);
  assert.match(setupFlow, /setWizardRecoveryMode\("runtime"\)/);
});

test('BUG-WIZ-01 返回配置页后继续 Gateway 终态核验而不重启官方向导', () => {
  const wizardHook = hookFile('useWizardSession');
  const autoStart = wizardHook.slice(
    wizardHook.indexOf('const wizardAutoStartRef'),
    wizardHook.indexOf('return {', wizardHook.indexOf('const wizardAutoStartRef')),
  );

  assert.match(autoStart, /wizardRecoveryModeRef\.current === "runtime"[\s\S]*?retryOfficialOnboarding\(\)/);
  assert.match(autoStart, /wizardRecoveryModeRef\.current === "terminal-unknown"\) return/);
  assert.match(autoStart, /void startOfficialOnboarding\(\)/);
});

test('BUG-ONB-46 Gateway 执行的进度步骤只由官方会话轮询', () => {
  const wizard = screen('WizardScreen');
  const wizardHook = hookFile('useWizardSession');

  assert.match(wizard, /step\?\.type === "progress" && step\.executor === "gateway"/);
  assert.match(wizard, /autoPolledProgressStepRef\.current === step\.id/);
  assert.match(wizard, /void wizard\.pollWizard\(\)/);
  assert.match(wizardHook, /pollWizard: pollOfficialOnboarding/);
  assert.doesNotMatch(wizard, /terminalQrCaptureActive|terminalQrFallback|wizardScanQrUrl/);
});

test('a superseded wizard submit releases its re-entry guard', () => {
  // 向导提交期间允许在错误状态下重试；接管操作必须同步释放旧提交的所有权，
  // 否则旧请求的 finally 不会清理守卫，后续向导操作会永久失去响应。
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
  const review = screen('EnvironmentEntryScreen');
  const redetect = hookFile('useSetupEnvironmentReview');

  assert.match(review, /const dockerInstalled = flow\.dockerStatus\?\.available === true/);
  assert.match(review, /const dockerReady = dockerInstalled && flow\.dockerStatus\?\.daemon_running === true/);
  assert.match(review, /setup\.dockerRunning/);
  assert.match(review, /setup\.dockerInstalledStopped/);
  assert.match(review, /setup\.dockerNotDetected/);
  assert.match(review, /loading: flow\.checkingDocker/);
  assert.match(review, /setup\.recheckingEnvironmentHint/);
  assert.match(redetect, /detectEnvironment\(runId\)/);
  assert.doesNotMatch(redetect, /navigateSetup\("detecting", "replace"\)/);
});

test('BUG-ONB-44 配置向导可在首条诊断前默认展开日志，其余步骤不展示空日志面板', () => {
  assert.match(setupFlowPanels, /const shouldShowLogs = isRuntime && showLogToggle && \(logs\.length > 0 \|\| logVisibility === "expanded"\)/);
  assert.match(setupFlowPanels, /disabled=\{!logText\}/);
  assert.match(screen('ProgressScreen'), /<InstallationConsole/);
});
