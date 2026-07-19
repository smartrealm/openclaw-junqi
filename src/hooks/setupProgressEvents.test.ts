import assert from "node:assert/strict";
import test from "node:test";
import { classifySetupMessage, normalizeSetupProgressPayload } from "./setupProgressEvents";

test("structured setup events retain step, error, and normalized local progress", () => {
  assert.deepEqual(
    normalizeSetupProgressPayload({
      step: "pull",
      message: "layer: Downloading 1MB/2MB",
      progress: 0.5,
      error: null,
      key: null,
      params: { path: "/tmp/openclaw" },
      status: null,
    }),
    {
      step: "pull",
      message: "layer: Downloading 1MB/2MB",
      progress: 50,
      diagnostic: false,
      error: null,
      key: null,
      params: { path: "/tmp/openclaw" },
      status: null,
    },
  );
});

test("plain legacy events remain readable without inventing metadata", () => {
  assert.deepEqual(normalizeSetupProgressPayload("Waiting for gateway"), {
    step: null,
    message: "Waiting for gateway",
    progress: null,
    diagnostic: false,
    error: null,
    key: null,
    params: {},
    status: null,
  });
});

test("structured setup events ignore non-string translation parameters", () => {
  const event = normalizeSetupProgressPayload({
    step: "openclaw",
    message: "Preparing install directory /tmp/openclaw...",
    key: "setup.openclaw.prepareDir",
    params: { path: "/tmp/openclaw", unsafe: { nested: true }, count: 2 },
  });
  assert.deepEqual(event?.params, { path: "/tmp/openclaw" });
});

test("setup log classification recognizes npm errors, fallbacks, and success", () => {
  assert.equal(classifySetupMessage("npm ERR! lifecycle failed"), "error");
  assert.equal(classifySetupMessage("npm ERR!"), "error");
  assert.equal(classifySetupMessage("retrying with fallback source"), "warn");
  assert.equal(classifySetupMessage("OpenClaw is not installed"), "warn");
  assert.equal(classifySetupMessage("Image pulled successfully"), "success");
  assert.equal(classifySetupMessage("Downloading package metadata"), "info");
});
