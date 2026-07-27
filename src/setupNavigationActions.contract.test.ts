import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const setupFlow = read("./hooks/useSetupFlow/index.ts");
const wizardSession = read("./hooks/useSetupFlow/useWizardSession.ts");
const pluginRecovery = read("./hooks/useSetupFlow/usePluginRecovery.ts");
const welcome = read("./pages/SetupPage/WelcomeScreen.tsx");
const mode = read("./pages/SetupPage/ModeSelectScreen.tsx");
const storageGate = read("./components/setup/StorageSetupGate.tsx");

test("welcome and runtime selection Next actions are single-flight", () => {
  assert.match(welcome, /const navigationInFlightRef = useRef\(false\)/);
  assert.match(welcome, /if \(navigationInFlightRef\.current\) return;[\s\S]*?navigationInFlightRef\.current = true;[\s\S]*?navigateSetup\("detecting"\)/);
  assert.match(setupFlow, /const selectMode[\s\S]*?runtimeSelectionInFlightRef\.current[\s\S]*?await performRuntimeSelection\(mode\)/);
  assert.match(mode, /previousAction=\{\{ onClick: flow\.goBack, disabled: submitting \}\}/);
  assert.match(mode, /disabled: submitting \|\| \(selectedMode === "docker" && !dockerAvailable\)/);
});

test("storage Back, configure, and advance actions exclude one another synchronously", () => {
  for (const ref of ["applyInFlightRef", "advanceInFlightRef", "backInFlightRef"]) {
    assert.match(storageGate, new RegExp(`const ${ref} = useRef\\(false\\)`));
  }
  assert.match(storageGate, /applyInFlightRef\.current \|\| advanceInFlightRef\.current \|\| backInFlightRef\.current/);
});

test("environment detection Back invalidates the probe before it can auto-advance", () => {
  const redetect = setupFlow.slice(
    setupFlow.indexOf("const redetectEnvironment"),
    setupFlow.indexOf("// ── Docker detect"),
  );
  assert.match(setupFlow, /if \(setupStep !== "detecting"\) return;[\s\S]*?const runId = beginRun\(\)/);
  assert.match(setupFlow, /const detectionWasCancelled = \(\) => \([\s\S]*?!isRunActive\(runId\)[\s\S]*?setupNavigationLeavingRef\.current/);
  assert.match(setupFlow, /const next = await detectEnvironmentForReview\(runId\);[\s\S]*?navigateSetup\("environment-review", "replace"\)/);
  assert.match(setupFlow, /const continueAfterEnvironmentReview[\s\S]*?navigateSetup\("storage", "push"\)/);
  assert.match(redetect, /setCheckingDocker\(true\);[\s\S]*?detectEnvironmentForReview\(runId\)/);
  assert.doesNotMatch(redetect, /navigateSetup\("detecting", "replace"\)/);
  assert.match(setupFlow, /const performGoBack[\s\S]*?cancelActiveRun\(\);[\s\S]*?const backPolicy = setupBackPolicy\(setupStep\);[\s\S]*?if \(backPolicy === "cancel-run"\)[\s\S]*?goBackSetup\("welcome"\)[\s\S]*?return;/);
});

test("Gateway alternatives invalidate auto-start before navigating", () => {
  assert.match(setupFlow, /const requestReinstall[\s\S]*?cancelActiveRun\(\);[\s\S]*?navigateSetup\("choosing-mode", "push"\)/);
  assert.match(setupFlow, /const refreshRuntime[\s\S]*?const runId = beginRun\(\);[\s\S]*?if \(!isRunActive\(runId\)\) return/);
});

test("Back skips duplicate current-page history entries", () => {
  assert.match(setupFlow, /while \(isStaleSetupBackDestination\(destination\) \|\| destination === setupStep\)/);
});

test("global Back is single-flight and fences automatic forward effects", () => {
  assert.match(setupFlow, /const setupBackInFlightRef = useRef\(false\)/);
  assert.match(setupFlow, /const setupNavigationLeavingRef = useRef\(false\)/);
  assert.match(setupFlow, /if \(setupNavigationLeavingRef\.current \|\| autoStartedGatewayRef\.current\) return/);
  assert.match(setupFlow, /const performGoBack[\s\S]*?setupNavigationLeavingRef\.current = true;[\s\S]*?rollbackRuntimeReconfiguration\(\)/);
  assert.match(setupFlow, /const goBack[\s\S]*?setupBackInFlightRef\.current[\s\S]*?isPluginRecoveryInFlight\(\)[\s\S]*?isWizardOperationInFlight\(\)[\s\S]*?await performGoBack\(\)/);
  assert.match(wizardSession, /if \(navigationLeavingRef\.current \|\| wizardStep \|\| wizardSubmitting \|\| wizardError\) return;[\s\S]*?startOfficialOnboarding/);
});

test("wizard auto-start runs at most once per configure-page visit", () => {
  assert.match(wizardSession, /if \(setupStep !== "configure-openclaw"\) \{\s*wizardAutoStartRef\.current = false;\s*return;\s*\}/);
  assert.match(wizardSession, /wizardAutoStartRef\.current = true;\s*void startOfficialOnboarding\(\);/);
  assert.doesNotMatch(wizardSession, /startOfficialOnboarding\(\)\.finally\([\s\S]*?wizardAutoStartRef\.current = false/);
});

test("wizard Back and Next share one synchronous gate", () => {
  assert.match(wizardSession, /wizardNavigationInFlightRef = useRef<"next" \| "back" \| null>/);
  assert.match(wizardSession, /const submitWizardStep[\s\S]*?if \(wizardNavigationInFlightRef\.current\) return null;[\s\S]*?wizardNavigationInFlightRef\.current = "next"/);
  assert.match(wizardSession, /const backOfficialOnboarding[\s\S]*?if \(!wizardClientRef\.current\?\.canGoBack \|\| wizardNavigationInFlightRef\.current\) return null;[\s\S]*?wizardNavigationInFlightRef\.current = "back"/);
});

test("recovery and dependency actions are single-flight", () => {
  assert.match(wizardSession, /const retryOfficialOnboarding[\s\S]*?if \(wizardRecoveryInFlightRef\.current \|\| wizardNavigationInFlightRef\.current\) return null/);
  assert.match(wizardSession, /const reclaimOfficialOnboarding[\s\S]*?if \(wizardRecoveryInFlightRef\.current \|\| wizardNavigationInFlightRef\.current\) return null/);
  assert.match(pluginRecovery, /repairInFlightRef = useRef<"repair" \| "disable" \| null>/);
  assert.match(pluginRecovery, /repairInFlightRef\.current = "repair"/);
  assert.match(pluginRecovery, /repairInFlightRef\.current = "disable"/);
  assert.match(pluginRecovery, /const repairAndRetry[\s\S]*?repairInFlightRef\.current \|\| isConflictingRecoveryInFlight\(\)/);
  assert.match(pluginRecovery, /const disablePluginsAndRetry[\s\S]*?repairInFlightRef\.current \|\| isConflictingRecoveryInFlight\(\)/);
  assert.match(setupFlow, /retrySetupInFlightRef = useRef\(false\)/);
  assert.match(setupFlow, /const retrySetup[\s\S]*?retrySetupInFlightRef\.current[\s\S]*?isPluginRecoveryInFlight\(\)[\s\S]*?isWizardOperationInFlight\(\)[\s\S]*?return false/);
  assert.match(setupFlow, /dependencyRetryInFlightRef = useRef<"git" \| "node" \| null>/);
  assert.match(setupFlow, /const retryGit[\s\S]*?retrySetupInFlightRef\.current[\s\S]*?isPluginRecoveryInFlight\(\)[\s\S]*?dependencyRetryInFlightRef\.current = "git"/);
  assert.match(setupFlow, /const retryNode[\s\S]*?retrySetupInFlightRef\.current[\s\S]*?isPluginRecoveryInFlight\(\)[\s\S]*?dependencyRetryInFlightRef\.current = "node"/);
});
