import assert from "node:assert/strict";
import test from "node:test";
import {
  backSetupNavigation,
  isStaleSetupBackDestination,
  normalizeInstallMode,
  transitionSetupNavigation,
  type SetupNavigationState,
} from "./setup-navigation";

function start(): SetupNavigationState {
  return { setupStep: "welcome", setupHistory: [] };
}

test("transient detection is replaced so storage returns to welcome", () => {
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = backSetupNavigation(state);

  assert.deepEqual(state, { setupStep: "welcome", setupHistory: [] });
});

test("an install failure returns to the confirmed mode selection", () => {
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = transitionSetupNavigation(state, "choosing-mode", "push");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "error", "replace");
  state = backSetupNavigation(state);

  assert.equal(state.setupStep, "choosing-mode");
  assert.deepEqual(state.setupHistory, ["welcome", "storage"]);
});

test("reinstall mode selection returns to the stopped Gateway result", () => {
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = transitionSetupNavigation(state, "gateway-stopped", "push");
  state = transitionSetupNavigation(state, "choosing-mode", "push");
  state = backSetupNavigation(state);

  assert.equal(state.setupStep, "gateway-stopped");
});

test("a failed Gateway start returns to the screen that started it", () => {
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = transitionSetupNavigation(state, "gateway-stopped", "push");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "error", "replace");
  state = backSetupNavigation(state);

  assert.equal(state.setupStep, "gateway-stopped");
});

test("internal retries replace the current step without growing history", () => {
  const state: SetupNavigationState = {
    setupStep: "error",
    setupHistory: ["welcome", "storage", "choosing-mode"],
  };
  const checking = transitionSetupNavigation(state, "checking", "replace");
  const failedAgain = transitionSetupNavigation(checking, "error", "replace");

  assert.deepEqual(failedAgain.setupHistory, state.setupHistory);
});

test("a step that reports a run is never a Back destination", () => {
  // The progress screen renders no Back and no primary action for the install
  // steps, so landing on one leaves nothing to click; `error` renders actions
  // but they offer to repair a failure a later success already resolved.
  for (const step of ["detecting", "gateway-stopped", "checking", "install-git", "install-node", "install-openclaw", "error"] as const) {
    assert.equal(isStaleSetupBackDestination(step), true, step);
  }
  for (const step of ["welcome", "storage", "choosing-mode", "gateway-ready", "configure-openclaw", "ready", "git-missing", "node-missing"] as const) {
    assert.equal(isStaleSetupBackDestination(step), false, step);
  }
});

test("Back from Gateway Ready skips an auto-starting stopped-Gateway page", () => {
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = transitionSetupNavigation(state, "gateway-stopped", "push");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "gateway-ready", "replace");

  let destination = backSetupNavigation(state);
  while (isStaleSetupBackDestination(destination.setupStep)) {
    destination = backSetupNavigation(destination);
  }

  assert.equal(destination.setupStep, "storage");
});

test("repairing from the error screen does not make it a Back destination", () => {
  // repairAndRetry runs from `error`, and startGatewayAction pushes `checking`
  // on top of it — the only path that puts `error` into history.
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = transitionSetupNavigation(state, "choosing-mode", "push");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "error", "replace");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "gateway-ready", "replace");

  assert.ok(state.setupHistory.includes("error"));

  let destination = backSetupNavigation(state);
  while (isStaleSetupBackDestination(destination.setupStep)) {
    destination = backSetupNavigation(destination);
  }

  assert.equal(destination.setupStep, "choosing-mode");
});

test("Gateway startup does not leave the install step as a Back destination", () => {
  // runNativeSetup replaces its way to install-openclaw, then startGatewayAction
  // pushes `checking` on top of it — which is what put a transient step into
  // history in the first place.
  let state = transitionSetupNavigation(start(), "detecting", "push");
  state = transitionSetupNavigation(state, "storage", "replace");
  state = transitionSetupNavigation(state, "choosing-mode", "push");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "install-openclaw", "replace");
  state = transitionSetupNavigation(state, "checking", "push");
  state = transitionSetupNavigation(state, "gateway-ready", "replace");

  assert.ok(state.setupHistory.includes("install-openclaw"));

  let destination = backSetupNavigation(state);
  while (isStaleSetupBackDestination(destination.setupStep)) {
    destination = backSetupNavigation(destination);
  }

  assert.equal(destination.setupStep, "choosing-mode");
});

test("skipping transient history terminates at the fallback", () => {
  const state: SetupNavigationState = {
    setupStep: "gateway-ready",
    setupHistory: ["checking", "install-node", "install-openclaw"],
  };

  let destination = backSetupNavigation(state);
  let guard = 0;
  while (isStaleSetupBackDestination(destination.setupStep)) {
    destination = backSetupNavigation(destination);
    assert.ok((guard += 1) < 10, "Back navigation must not loop");
  }

  assert.equal(destination.setupStep, "welcome");
});

test("persisted install mode fails closed to native setup", () => {
  assert.equal(normalizeInstallMode("docker"), "docker");
  assert.equal(normalizeInstallMode("native"), "native");
  assert.equal(normalizeInstallMode("legacy-value"), "native");
  assert.equal(normalizeInstallMode(null), "native");
});
