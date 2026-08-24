import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpenclawUpdateIndicator } from "./openclawUpdateIndicator";

test("resolved update indicators distinguish current and available versions", () => {
  assert.equal(
    resolveOpenclawUpdateIndicator("ready", {
      available: false,
      error: null,
      managedChannelPolicy: "eligible",
    }),
    "current",
  );
  assert.equal(
    resolveOpenclawUpdateIndicator("ready", {
      available: true,
      error: null,
      managedChannelPolicy: "eligible",
    }),
    "available",
  );
});

test("busy and error phases hide stale available-version state", () => {
  const staleAvailable = {
    available: true,
    error: null,
    managedChannelPolicy: "eligible" as const,
  };
  assert.equal(resolveOpenclawUpdateIndicator("updating", staleAvailable), "busy");
  assert.equal(resolveOpenclawUpdateIndicator("error", staleAvailable), "error");
});

test("unsupported and unknown channels render a blocking state", () => {
  for (const managedChannelPolicy of ["unsupported", "unknown"] as const) {
    assert.equal(resolveOpenclawUpdateIndicator("ready", {
      available: true,
      error: null,
      managedChannelPolicy,
    }), "error");
  }
});

test("an unverified successful update does not claim the channel is current", () => {
  assert.equal(resolveOpenclawUpdateIndicator("success", null), "idle");
});
