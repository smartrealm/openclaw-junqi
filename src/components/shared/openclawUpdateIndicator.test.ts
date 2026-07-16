import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpenclawUpdateIndicator } from "./openclawUpdateIndicator";

test("resolved update indicators distinguish current and available versions", () => {
  assert.equal(
    resolveOpenclawUpdateIndicator("ready", { available: false, error: null }),
    "current",
  );
  assert.equal(
    resolveOpenclawUpdateIndicator("ready", { available: true, error: null }),
    "available",
  );
});

test("busy and error phases hide stale available-version state", () => {
  const staleAvailable = { available: true, error: null };
  assert.equal(resolveOpenclawUpdateIndicator("updating", staleAvailable), "busy");
  assert.equal(resolveOpenclawUpdateIndicator("error", staleAvailable), "error");
});

test("an unverified successful update does not claim the channel is current", () => {
  assert.equal(resolveOpenclawUpdateIndicator("success", null), "idle");
});
