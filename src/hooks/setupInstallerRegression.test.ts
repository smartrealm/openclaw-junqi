import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupFlowPanels = readFileSync(new URL('../components/setup/SetupFlowPanels.tsx', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const setupCommands = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const gitRuntime = readFileSync(new URL('../../src-tauri/src/commands/git_runtime.rs', import.meta.url), 'utf8');
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
  assert.match(gitRuntime, /releases\/latest/);
  assert.match(gitRuntime, /"x86_64" => "-64-bit\.zip"/);
  assert.match(gitRuntime, /"aarch64" => "-arm64\.zip"/);
  assert.match(gitRuntime, /sha256/);
  assert.doesNotMatch(setupCommands, /GIT_WIN_VERSION/);
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
