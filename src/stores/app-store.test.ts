import assert from "node:assert/strict";
import test from "node:test";
import { useAppStore } from "./app-store";
import { isStaleSetupBackDestination } from "./setup-navigation";

// `goBack` in useSetupFlow drives `goBackSetup` in a loop until it lands on a
// step the user can act on. That loop only terminates because `goBackSetup`
// reads its result out of a synchronous `set` updater, so each call observes
// the history the previous one popped. A store middleware that defers the
// updater would turn the loop into a hang with a frozen setup window, which is
// why the contract is asserted here rather than only against the pure reducer.
test("repeated goBackSetup pops history so transient steps can be skipped", () => {
  useAppStore.setState({
    setupStep: "gateway-ready",
    setupHistory: ["welcome", "choosing-mode", "checking", "install-openclaw"],
  });

  const { goBackSetup } = useAppStore.getState();
  let destination = goBackSetup("welcome");
  let iterations = 0;
  while (isStaleSetupBackDestination(destination)) {
    destination = goBackSetup("welcome");
    iterations += 1;
    assert.ok(iterations < 10, "each goBackSetup call must consume one history entry");
  }

  assert.equal(destination, "choosing-mode");
  assert.equal(useAppStore.getState().setupStep, "choosing-mode");
  assert.deepEqual(useAppStore.getState().setupHistory, ["welcome"]);
});

test("goBackSetup falls back once history is exhausted", () => {
  useAppStore.setState({ setupStep: "checking", setupHistory: [] });

  assert.equal(useAppStore.getState().goBackSetup("welcome"), "welcome");
  assert.equal(useAppStore.getState().setupStep, "welcome");
});
