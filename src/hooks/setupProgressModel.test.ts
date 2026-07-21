import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSetupProgress,
  phaseForSetupEvent,
  progressForSetupEvent,
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

test("docker event progress follows pull, container, and gateway ranges", () => {
  assert.equal(progressForSetupEvent("pull", 0, "docker"), 31);
  assert.equal(progressForSetupEvent("pull", 100, "docker"), 65);
  assert.equal(progressForSetupEvent("container", 0, "docker"), 66);
  assert.equal(progressForSetupEvent("container", 100, "docker"), 84);
  assert.equal(progressForSetupEvent("gateway", 100, "docker"), 99);
  assert.equal(progressForSetupEvent("unknown", 50, "docker"), null);
});

test("local task progress is mapped into its global phase range", () => {
  const range = SETUP_PROGRESS_RANGES.openclaw;
  assert.equal(progressForPhase("openclaw", 0), range.start);
  assert.equal(progressForPhase("openclaw", 50), Math.round((range.start + range.end) / 2));
  assert.equal(progressForPhase("openclaw", 100), range.end);
});

test("global setup progress cannot move backwards", () => {
  assert.equal(advanceSetupProgress(80, "gatewayConfig", 0), SETUP_PROGRESS_RANGES.gatewayConfig.start);
  assert.equal(advanceSetupProgress(90, "gatewayConfig", 100), 90);
});

test("backend steps resolve through one phase registry", () => {
  assert.equal(phaseForSetupEvent("git"), "openclaw");
  assert.equal(phaseForSetupEvent("node"), "node");
  assert.equal(phaseForSetupEvent("gateway"), "gatewayPrepare");
  assert.equal(phaseForSetupEvent("unknown"), null);
});
