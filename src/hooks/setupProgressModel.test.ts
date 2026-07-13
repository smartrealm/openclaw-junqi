import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSetupProgress,
  phaseForSetupEvent,
  progressForPhase,
  SETUP_PROGRESS_RANGES,
} from "./setupProgressModel";

test("setup phase ranges are contiguous and never decrease", () => {
  const ranges = Object.values(SETUP_PROGRESS_RANGES);
  for (let index = 1; index < ranges.length; index += 1) {
    assert.ok(ranges[index].start >= ranges[index - 1].end);
  }
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges.at(-1)?.end, 100);
});

test("local task progress is mapped into its global phase range", () => {
  assert.equal(progressForPhase("openclaw", 0), 40);
  assert.equal(progressForPhase("openclaw", 50), 54);
  assert.equal(progressForPhase("openclaw", 100), 68);
});

test("global setup progress cannot move backwards", () => {
  assert.equal(advanceSetupProgress(75, "gatewayConfig", 0), 76);
  assert.equal(advanceSetupProgress(90, "gatewayConfig", 100), 90);
});

test("backend steps resolve through one phase registry", () => {
  assert.equal(phaseForSetupEvent("node"), "node");
  assert.equal(phaseForSetupEvent("gateway"), "gatewayPrepare");
  assert.equal(phaseForSetupEvent("unknown"), null);
});
