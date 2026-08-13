import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const setupFlow = read("./hooks/useSetupFlow/index.ts");
const wizardSession = read("./hooks/useSetupFlow/useWizardSession.ts");
const environmentReview = read("./hooks/useSetupFlow/useSetupEnvironmentReview.ts");
const pluginRecovery = read("./hooks/useSetupFlow/usePluginRecovery.ts");
const welcome = read("./pages/SetupPage/EnvironmentEntryScreen.tsx");
const mode = read("./pages/SetupPage/ModeSelectScreen.tsx");

test("welcome and runtime selection Next actions are single-flight", () => {
  assert.match(welcome, /const navigationInFlightRef = useRef\(false\)/);
  assert.match(welcome, /if \(navigationInFlightRef\.current\) return;[\s\S]*?navigationInFlightRef\.current = true;[\s\S]*?navigateSetup\("detecting"\)/);
  assert.match(setupFlow, /const selectMode[\s\S]*?runtimeSelectionInFlightRef\.current[\s\S]*?await performRuntimeSelection\(mode\)/);
  assert.match(mode, /previousAction=\{\{ onClick: flow\.goBack, disabled: submitting \}\}/);
  assert.match(mode, /disabled: submitting \|\| \(selectedMode === "docker" && !dockerAvailable\)/);
});

test("environment detection Back invalidates the probe before it can auto-advance", () => {
  assert.match(environmentReview, /if \(setupStep !== "detecting"\) return;[\s\S]*?const runId = beginRun\(\)/);
  assert.match(environmentReview, /const cancelled = \(\) => !isRunActive\(runId\) \|\| navigationLeavingRef\.current/);
  assert.match(environmentReview, /settleInitialEnvironmentDetection\([\s\S]*?detectEnvironment\(runId\)[\s\S]*?checkDocker\(\)[\s\S]*?navigateSetup\("environment-review", "replace"\)/);
  assert.match(environmentReview, /const continueAfterEnvironmentReview[\s\S]*?navigateSetup\("storage", "push"\)/);
  assert.doesNotMatch(environmentReview, /navigateSetup\("detecting", "replace"\)/);
  assert.match(setupFlow, /const performGoBack[\s\S]*?invalidateActiveRun\(\);[\s\S]*?const backPolicy = setupBackPolicy\(setupStep\);[\s\S]*?if \(backPolicy === "cancel-run"\)[\s\S]*?goBackSetup\("welcome"\)[\s\S]*?return;/);
});

test("Gateway alternatives invalidate auto-start before navigating", () => {
  assert.match(setupFlow, /const requestReinstall[\s\S]*?invalidateActiveRun\(\);[\s\S]*?navigateSetup\("choosing-mode", "push"\)/);
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
  assert.doesNotMatch(wizardSession, /wizardAutoStartRef/);
});

test("wizard preparation is explicit and configure-page mount has no protocol side effect", () => {
  assert.match(wizardSession, /prepareWizard: \(\) => startOfficialOnboarding\(false, setupStep !== "configure-openclaw"\)/);
  assert.doesNotMatch(wizardSession, /wizardAutoStartRef/);
});

test("wizard Next is single-flight and page Back does not replay protocol answers", () => {
  assert.match(wizardSession, /wizardNavigationInFlightRef = useRef<"next" \| null>/);
  assert.match(wizardSession, /const submitWizardStep[\s\S]*?if \(wizardNavigationInFlightRef\.current\) return null;[\s\S]*?wizardNavigationInFlightRef\.current = "next"/);
  assert.doesNotMatch(wizardSession, /backOfficialOnboarding|\.back\(\)|canGoBack/);
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
