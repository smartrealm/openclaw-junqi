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

// A coalesced row is replaced in place, so its timestamp must stay the one its
// position stands for. Stamping the update time onto it made the setup console
// read as if time ran backwards: the npm network summary carried a timestamp
// minutes later than the rows printed below it.
test("a coalesced setup log keeps the timestamp of the row it replaces", () => {
  useAppStore.setState({ setupLogs: [] });
  const { appendSetupLog } = useAppStore.getState();

  appendSetupLog({ source: "setup", step: "openclaw", message: "npm summary: 1 request", ts: 1_000, coalesceKey: "npm-network" });
  appendSetupLog({ source: "setup", step: "openclaw", message: "npm › added 309 packages", ts: 2_000 });
  appendSetupLog({ source: "setup", step: "openclaw", message: "npm summary: 58 requests", ts: 3_000, coalesceKey: "npm-network" });

  const logs = useAppStore.getState().setupLogs;
  assert.equal(logs.length, 2);
  assert.equal(logs[0]!.message, "npm summary: 58 requests");
  assert.equal(logs[0]!.ts, 1_000, "the replaced row keeps its original timestamp");
  assert.deepEqual(logs.map((log) => log.ts), [1_000, 2_000], "timestamps stay non-decreasing");
});
