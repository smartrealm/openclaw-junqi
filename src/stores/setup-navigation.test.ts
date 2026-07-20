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

test("persisted install mode fails closed to native setup", () => {
  assert.equal(normalizeInstallMode("docker"), "docker");
  assert.equal(normalizeInstallMode("native"), "native");
  assert.equal(normalizeInstallMode("legacy-value"), "native");
  assert.equal(normalizeInstallMode(null), "native");
});
