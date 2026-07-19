import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const storageGate = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../api/tauri-adapter.ts', import.meta.url), 'utf8');
const setupCommand = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');

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
  const locales = Object.fromEntries(['zh', 'en', 'ar'].map((locale) => [
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

  assert.match(wizard, /const messageRenderedInBody = step\.type === "confirm"/);
  assert.match(wizard, /subtitle=\{wizardSubtitle\}/);
  assert.match(wizard, /aria-label=\{step\.title \|\| t\("setup\.wizard\.textInput"/);
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

test('BUG-ONB-15 runtime navigation uses its own label instead of repeating environment detection', () => {
  const zh = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));

  assert.deepEqual(zh.setup.steps.runtime, {
    title: '运行时',
    description: '安装并启动 Gateway',
  });
  assert.deepEqual(en.setup.steps.runtime, {
    title: 'Runtime',
    description: 'Install and start Gateway',
  });
});

test('BUG-ONB-09 native setup verifies optional terminal integration after OpenClaw', () => {
  const openclawStep = setupFlow.indexOf('patchStep("openclaw", "done"');
  const terminalStep = setupFlow.indexOf('await configureTerminalIntegration(runId)', openclawStep);
  const gatewayStep = setupFlow.indexOf('patchStep("gateway", "running"', terminalStep);

  assert.ok(openclawStep >= 0);
  assert.ok(terminalStep > openclawStep);
  assert.ok(gatewayStep > terminalStep);
  assert.match(setupFlow, /const terminalStatus = await applyTerminalIntegration\(\)/);
  assert.match(setupFlow, /!terminalStatus\.enabled \|\| !terminalStatus\.launcherReady/);
  assert.match(setupFlow, /patchStep\("terminal", "skipped"/);
});

test('BUG-ONB-10 setup leaves system tools and npm cache at their native defaults', () => {
  assert.doesNotMatch(storageGate, /label=\{t\('storage\.runtimeLocation'/);
  assert.match(storageGate, /checked=\{customNpmCache\}/);
  assert.match(storageGate, /npmCacheDir: customNpmCache \? npmCacheDir\.trim\(\) \|\| null : null/);
  assert.match(storageGate, /npmCacheDir: string \| null/);
  assert.match(storageGate, /关闭时使用 npm 在当前系统和用户下的默认缓存位置/);
});

test('BUG-CPI-03 macOS missing Node runs the domestic system-installer recovery path', () => {
  assert.match(setupFlow, /const setupNode = await checkSetupNode\(\)/);
  assert.doesNotMatch(setupFlow, /useMacSystemRecovery/);
  assert.match(setupFlow, /if \(!nodeStatus\.available\)[\s\S]*?await installNode\(\)/);
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
  assert.match(setupCommand, /let config_path = paths::config_path\(\)/);
  assert.match(setupCommand, /Reading gateway port from \{\}\.\.\./);
});

test('FEAT-AUTOSTART ready screen offers boot autostart with runtime handover', () => {
  const gatewayService = readFileSync(
    new URL('../../src-tauri/src/commands/gateway_service.rs', import.meta.url),
    'utf8',
  );
  const registration = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  // The option is only offered for the Native runtime; Docker containers rely
  // on their restart policy instead of a host-level service.
  assert.match(setupPage, /function GatewayAutostartCard/);
  assert.match(setupPage, /installMode !== "native" \|\| !status\?\.supported/);
  assert.match(setupPage, /<GatewayAutostartCard installMode=\{flow\.installMode\} \/>/);

  // Enable/disable goes through the official CLI service commands and then
  // hands the port over via the existing restart path, so exactly one owner
  // (system service or desktop app) serves the gateway afterwards.
  assert.match(gatewayService, /"gateway", "install", "--json", "--force"/);
  assert.match(gatewayService, /"gateway", "uninstall"/);
  assert.match(gatewayService, /"gateway", "status", "--json", "--no-probe"/);
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
