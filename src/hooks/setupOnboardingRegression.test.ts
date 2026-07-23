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
  assert.match(detection, /selectedRuntime === "native" \? await checkOpenclaw\(\) : null/);
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

test('BUG-ONB-05 install mode selection is explicit and confirmed by Next', () => {
  const mode = setupPage.slice(
    setupPage.indexOf('function ModeSelectScreen'),
    setupPage.indexOf('function ProgressScreen'),
  );

  assert.match(mode, /aria-pressed=\{selectedMode === "native"\}[\s\S]*?setSelectedMode\("native"\)/);
  assert.match(mode, /disabled=\{!dockerAvailable\}[\s\S]*?aria-pressed=\{selectedMode === "docker"\}[\s\S]*?setSelectedMode\("docker"\)/);
  assert.match(mode, /label: t\("setup\.nextStep"[\s\S]*?flow\.selectMode\(selectedMode\)/);
  assert.doesNotMatch(mode, /flow\.selectMode\("(?:native|docker)"\)/);
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
    ready: { title: '完成', description: '进入工作台' },
  };
  const enExpected = {
    identity: { title: 'Preferences', description: 'Language / Theme' },
    environment: { title: 'Environment', description: 'OpenClaw / Docker' },
    storage: { title: 'Data location', description: 'Configuration / Workspace' },
    runtime: { title: 'Runtime', description: 'Install and start Gateway' },
    configuration: { title: 'OpenClaw setup', description: 'Models / credentials / channels' },
    ready: { title: 'Ready', description: 'Enter workspace' },
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
  assert.match(setupFlowPanels, /export type InstallationConsoleSummaryState = "installation" \| "gateway-ready" \| "hidden";/);
  assert.match(setupFlowPanels, /const showSummary = summaryState !== "hidden";/);
  assert.match(setupFlowPanels, /summaryState === "gateway-ready"/);
  assert.match(setupPage, /const installationSummaryState: InstallationConsoleSummaryState = gatewayReadyChecking/);
  assert.match(setupPage, /summaryState=\{installationSummaryState\}/);
});

test('BUG-ONB-30 verified Gateway handoff cannot start cold recovery', () => {
  const coldRecovery = app.slice(
    app.indexOf('// During boot, separate two different failures:'),
    app.indexOf('// ── uiScale'),
  );

  assert.match(coldRecovery, /if \(workspaceStartupMode === 'verified-gateway-handoff'\) return;/);
  assert.match(coldRecovery, /workspaceStartupMode,/);
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

test('FEAT-AUTOSTART ready screen keeps autostart in a separate runtime-preferences section', () => {
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
  assert.match(ready, /<GatewayAutostartPreference installMode=\{flow\.installMode\} \/>/);
  assert.doesNotMatch(ready, /OpenClawUpdatePanel/);

  // Enable/disable goes through the official CLI service commands and then
  // hands the port over via the existing restart path, so exactly one owner
  // (system service or desktop app) serves the gateway afterwards.
  assert.match(gatewayService, /"gateway", "install", "--force", "--port", port\.as_str\(\)/);
  assert.match(gatewayService, /"gateway", "uninstall", "--json"/);
  assert.match(gatewayService, /fn service_status_args\(\)[\s\S]*"gateway", "status", "--json", "--no-probe"/);
  assert.match(gatewayService, /OpenClawRuntimeMode::Native/);
  assert.match(setupPage, /await window\.aegis\.config\.restart\(\)/);

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
