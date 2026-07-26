import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setupPage = readFileSync(new URL("./pages/SetupPage.tsx", import.meta.url), "utf8");
const setupFlow = readFileSync(new URL("./hooks/useSetupFlow.ts", import.meta.url), "utf8");
const storageGate = readFileSync(new URL("./components/setup/StorageSetupGate.tsx", import.meta.url), "utf8");

test("welcome and runtime selection Next actions are single-flight", () => {
  assert.match(
    setupPage,
    /const navigationInFlightRef = useRef\(false\);[\s\S]*?if \(navigationInFlightRef\.current\) return;[\s\S]*?navigationInFlightRef\.current = true;[\s\S]*?navigateSetup\("detecting"\)/,
  );
  assert.match(
    setupFlow,
    /const selectMode = useCallback[\s\S]*?if \(runtimeSelectionInFlightRef\.current \|\| setupBackInFlightRef\.current\) return;[\s\S]*?runtimeSelectionInFlightRef\.current = true;[\s\S]*?await performRuntimeSelection\(mode\)/,
  );
  assert.match(setupPage, /previousAction=\{\{ onClick: flow\.goBack, disabled: submitting \}\}/);
  assert.match(setupPage, /disabled: submitting \|\| \(selectedMode === "docker" && !dockerAvailable\)/);
});

test("storage Back, configure, and advance actions exclude one another synchronously", () => {
  assert.match(storageGate, /const applyInFlightRef = useRef\(false\)/);
  assert.match(storageGate, /const advanceInFlightRef = useRef\(false\)/);
  assert.match(storageGate, /const backInFlightRef = useRef\(false\)/);
  assert.match(
    storageGate,
    /if \(!status \|\| !targetDir \|\| applyInFlightRef\.current \|\| advanceInFlightRef\.current \|\| backInFlightRef\.current\) return;\s*\n\s*applyInFlightRef\.current = true;/,
  );
  assert.match(
    storageGate,
    /if \(!completion \|\| advanceInFlightRef\.current \|\| applyInFlightRef\.current \|\| backInFlightRef\.current\) return;\s*\n\s*advanceInFlightRef\.current = true;/,
  );
  assert.match(
    storageGate,
    /if \(backInFlightRef\.current \|\| applyInFlightRef\.current \|\| advanceInFlightRef\.current \|\| recoveringRuntime\) return;\s*\n\s*backInFlightRef\.current = true;/,
  );
});

test("global Back is single-flight and cannot race active forward transitions", () => {
  assert.match(setupFlow, /const setupBackInFlightRef = useRef\(false\)/);
  assert.match(
    setupFlow,
    /const goBack = useCallback[\s\S]*?setupBackInFlightRef\.current[\s\S]*?runtimeSelectionInFlightRef\.current[\s\S]*?retrySetupInFlightRef\.current[\s\S]*?dependencyRetryInFlightRef\.current[\s\S]*?repairInFlightRef\.current[\s\S]*?gatewayReadyContinuationInFlightRef\.current[\s\S]*?dashboardEntryInFlightRef\.current[\s\S]*?wizardNavigationInFlightRef\.current[\s\S]*?wizardRecoveryInFlightRef\.current[\s\S]*?setupBackInFlightRef\.current = true;[\s\S]*?await performGoBack\(\);[\s\S]*?setupBackInFlightRef\.current = false;/,
  );
});

test("error and dependency recovery actions are single-flight", () => {
  assert.match(setupFlow, /const retrySetupInFlightRef = useRef\(false\)/);
  assert.match(setupFlow, /const repairInFlightRef = useRef<"repair" \| "disable" \| null>\(null\)/);
  assert.match(setupFlow, /const dependencyRetryInFlightRef = useRef<"git" \| "node" \| null>\(null\)/);
  assert.match(
    setupFlow,
    /const retrySetup[\s\S]*?if \(retrySetupInFlightRef\.current \|\| setupBackInFlightRef\.current\) return false;[\s\S]*?retrySetupInFlightRef\.current = true;[\s\S]*?retrySetupInFlightRef\.current = false;/,
  );
  assert.match(
    setupFlow,
    /const repairAndRetry[\s\S]*?if \(repairInFlightRef\.current \|\| setupBackInFlightRef\.current\) return;[\s\S]*?repairInFlightRef\.current = "repair";[\s\S]*?repairInFlightRef\.current = null;/,
  );
  assert.match(
    setupFlow,
    /const disablePluginsAndRetry[\s\S]*?if \(repairInFlightRef\.current \|\| setupBackInFlightRef\.current\) return;[\s\S]*?repairInFlightRef\.current = "disable";[\s\S]*?repairInFlightRef\.current = null;/,
  );
  assert.match(setupFlow, /const retryGit[\s\S]*?dependencyRetryInFlightRef\.current = "git";[\s\S]*?runNativeSetup\(\)\.finally/);
  assert.match(setupFlow, /const retryNode[\s\S]*?dependencyRetryInFlightRef\.current = "node";[\s\S]*?runNativeSetup\(\)\.finally/);
});
