import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGatewayLogPayload, translateGatewayLogPayload } from "./gatewayLogEvents";

const translate = (key: string, options: Record<string, unknown>) => {
  const table: Record<string, string> = {
    "setup.gateway.reuseExisting": "已通过认证的现有 Gateway 已就绪，将直接复用。",
    "setup.gateway.probe": "探测 127.0.0.1:{{port}} 是否已有 Gateway 在监听…",
  };
  const template = table[key];
  if (!template) return options.defaultValue ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? `{{${name}}}`));
};

test("a keyed Gateway log line is translated", () => {
  const message = translateGatewayLogPayload(
    { message: "Authenticated existing Gateway is ready; reusing it.", key: "setup.gateway.reuseExisting" },
    translate,
  );
  assert.equal(message, "已通过认证的现有 Gateway 已就绪，将直接复用。");
});

test("params are recovered from the English message", () => {
  const message = translateGatewayLogPayload(
    { message: "Probing 127.0.0.1:18789 for an existing Gateway...", key: "setup.gateway.probe" },
    translate,
  );
  assert.equal(message, "探测 127.0.0.1:18789 是否已有 Gateway 在监听…");
});

test("child process output without a key is shown verbatim", () => {
  const message = translateGatewayLogPayload({ message: "gateway listening on :18789" }, translate);
  assert.equal(message, "gateway listening on :18789");
});

test("a bare string payload still resolves", () => {
  assert.deepEqual(normalizeGatewayLogPayload("  raw line  "), { message: "raw line", key: null });
  assert.equal(translateGatewayLogPayload("raw line", translate), "raw line");
});

test("empty and malformed payloads are dropped", () => {
  assert.equal(normalizeGatewayLogPayload(""), null);
  assert.equal(normalizeGatewayLogPayload("   "), null);
  assert.equal(normalizeGatewayLogPayload(null), null);
  assert.equal(normalizeGatewayLogPayload({ key: "setup.gateway.probe" }), null);
  assert.equal(translateGatewayLogPayload(undefined, translate), null);
});

test("an untranslated key falls back to the English message", () => {
  const message = translateGatewayLogPayload(
    { message: "Installed Gateway service is ready.", key: "setup.gateway.unknownKey" },
    translate,
  );
  assert.equal(message, "Installed Gateway service is ready.");
});
