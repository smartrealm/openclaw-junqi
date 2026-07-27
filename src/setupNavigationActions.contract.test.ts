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

test("global Back is single-flight and fences automatic forward effects", () => {
  assert.match(setupFlow, /const setupBackInFlightRef = useRef\(false\)/);
  assert.match(setupFlow, /const setupNavigationLeavingRef = useRef\(false\)/);
  assert.match(setupFlow, /if \(setupNavigationLeavingRef\.current \|\| autoStartedGatewayRef\.current\) return/);
  assert.match(setupFlow, /const performGoBack[\s\S]*?setupNavigationLeavingRef\.current = true;[\s\S]*?rollbackRuntimeReconfiguration\(\)/);
  assert.match(setupFlow, /const goBack[\s\S]*?setupBackInFlightRef\.current[\s\S]*?isPluginRecoveryInFlight\(\)[\s\S]*?isWizardOperationInFlight\(\)[\s\S]*?await performGoBack\(\)/);
  assert.match(wizardSession, /if \(navigationLeavingRef\.current\) return;[\s\S]*?startOfficialOnboarding/);
});

test("wizard Back and Next share one synchronous gate", () => {
  assert.match(wizardSession, /wizardNavigationInFlightRef = useRef<"next" \| "back" \| null>/);
  assert.match(wizardSession, /const submitWizardStep[\s\S]*?if \(wizardNavigationInFlightRef\.current\) return null;[\s\S]*?wizardNavigationInFlightRef\.current = "next"/);
  assert.match(wizardSession, /const backOfficialOnboarding[\s\S]*?if \(!wizardClientRef\.current\?\.canGoBack \|\| wizardNavigationInFlightRef\.current\) return null;[\s\S]*?wizardNavigationInFlightRef\.current = "back"/);
});

test("recovery and dependency actions are single-flight", () => {
  assert.match(pluginRecovery, /repairInFlightRef = useRef<"repair" \| "disable" \| null>/);
  assert.match(pluginRecovery, /repairInFlightRef\.current = "repair"/);
  assert.match(pluginRecovery, /repairInFlightRef\.current = "disable"/);
  assert.match(setupFlow, /retrySetupInFlightRef = useRef\(false\)/);
  assert.match(setupFlow, /dependencyRetryInFlightRef = useRef<"git" \| "node" \| null>/);
});
