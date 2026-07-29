import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertJavaScriptChunkBudget,
  failOnCircularChunk,
  JAVASCRIPT_CHUNK_BUDGET_KB,
  resolveManualChunk,
} from "./vite-chunk-strategy.mjs";

describe("Vite manual chunk strategy", () => {
  test("leaves application modules to Rollup's dependency graph", () => {
    const applicationModules = [
      "/repo/src/stores/settingsStore.ts",
      "/repo/src/services/gateway/index.ts",
      "/repo/src/processing/normalizeGatewayMessage.ts",
      "C:\\repo\\src\\theme\\useTheme.ts",
    ];

    for (const moduleId of applicationModules) {
      assert.equal(resolveManualChunk(moduleId), undefined, moduleId);
    }
  });

  test("groups stable third-party runtime boundaries", () => {
    assert.equal(
      resolveManualChunk("/repo/node_modules/react-dom/client.js"),
      "react-vendor",
    );
    assert.equal(
      resolveManualChunk("/repo/node_modules/pdfjs-dist/build/pdf.mjs"),
      "pdfjs",
    );
    assert.equal(
      resolveManualChunk("/repo/node_modules/@xterm/xterm/lib/xterm.js"),
      "xterm",
    );
  });

  test("keeps CodeMirror languages and d3 packages independently cacheable", () => {
    assert.equal(
      resolveManualChunk("/repo/node_modules/@codemirror/lang-rust/dist/index.js"),
      "cm-lang-rust",
    );
    assert.equal(
      resolveManualChunk(
        "/repo/node_modules/@codemirror/legacy-modes/mode/shell.js",
      ),
      "cm-lang-shell",
    );
    assert.equal(
      resolveManualChunk("/repo/node_modules/d3-scale/src/index.js"),
      "charts-d3-scale",
    );
  });

  test("does not mistake similarly named packages for an owned dependency", () => {
    assert.equal(
      resolveManualChunk("/repo/node_modules/react-dom-extra/index.js"),
      undefined,
    );
    assert.equal(
      resolveManualChunk("/repo/node_modules/@xtermish/core/index.js"),
      undefined,
    );
  });

  test("makes circular chunks a build failure and forwards other warnings", () => {
    assert.throws(
      () =>
        failOnCircularChunk(
          { code: "CIRCULAR_CHUNK", message: "Circular chunk: a -> b -> a" },
          () => assert.fail("circular warning must not be forwarded"),
        ),
      /Circular chunk: a -> b -> a/,
    );

    const forwarded = [];
    const warning = { code: "OTHER_WARNING", message: "kept" };
    failOnCircularChunk(warning, (value) => forwarded.push(value));
    assert.deepEqual(forwarded, [warning]);
  });

  test("fails a build that exceeds the shared JavaScript chunk budget", () => {
    assert.doesNotThrow(() =>
      assertJavaScriptChunkBudget({
        "within.js": {
          type: "chunk",
          fileName: "within.js",
          code: "x".repeat(JAVASCRIPT_CHUNK_BUDGET_KB * 1000),
        },
        "worker.js": {
          type: "asset",
          fileName: "worker.js",
          source: "x".repeat((JAVASCRIPT_CHUNK_BUDGET_KB + 1) * 1000),
        },
      }),
    );

    assert.throws(
      () =>
        assertJavaScriptChunkBudget({
          "oversized.js": {
            type: "chunk",
            fileName: "oversized.js",
            code: "x".repeat((JAVASCRIPT_CHUNK_BUDGET_KB + 1) * 1000),
          },
        }),
      /JavaScript chunk budget exceeded \(550 kB\): oversized\.js \(551\.00 kB\)/,
    );
  });
});
