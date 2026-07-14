
/**
 * Unit tests for `setupProgressParams`.
 *
 * The rule table `SETUP_PROGRESS_PARAM_RULES` is both the production
 * data and the source of truth for these tests. We assert that every
 * rule has at least one valid (key, message, params) case so the table
 * can never drift away from the i18n keys it claims to serve.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  setupProgressI18nParams,
  SETUP_PROGRESS_PARAM_RULES,
  type ParamRule,
} from "./setupProgressParams";

interface Case {
  key: string;
  message: string;
  expected: Record<string, string>;
}

/**
 * Every rule must have at least one case. The shape is keyed by the
 * rule's suffix so the test fails loudly if a new suffix is added
 * without a corresponding fixture.
 */
const CASES: Record<string, Case> = {
  // Generic version rule — covers a family of keys.
  "[.skip, .upgrade, .done]": {
    key: "setup.node.skip",
    message: "Skipping Node.js v22.10.0 (already installed)",
    expected: { version: "v22.10.0" },
  },
  "[.skip, .upgrade, .done] (detected)": {
    key: "setup.node.done",
    message: "Detected Node.js v20.5.1",
    expected: { version: "v20.5.1" },
  },
  "[.skip, .upgrade, .done] (no version → null → fallthrough)": {
    key: "setup.openclaw.done",
    message: "openclaw installed successfully ✓",
    // First rule matches the key but the extractor returns null;
    // no later rule matches .done either, so we get {}.
    expected: {},
  },
  ".prepareDownload": {
    key: "setup.node.prepareDownload",
    message: "Downloading Node.js v22.11.0…",
    expected: { version: "v22.11.0" },
  },
  ".extract": {
    key: "setup.node.extract",
    message: "Extracting to /Users/wei/.junqi/node…",
    expected: { path: "/Users/wei/.junqi/node" },
  },
  ".waitingWizard": {
    key: "setup.git.waitingWizard",
    message: "Waiting for wizard (elapsed 02:13)…",
    expected: { elapsed: "02:13" },
  },
  ".macPolling": {
    key: "setup.git.macPolling",
    message: "Polling git install (elapsed 00:42)",
    expected: { elapsed: "00:42" },
  },
  ".useLocalNode": {
    key: "setup.openclaw.useLocalNode",
    message: "Using local Node.js: /Users/wei/.openclaw/node/bin/node",
    expected: { path: "/Users/wei/.openclaw/node/bin/node" },
  },
  ".useLocalNpm": {
    key: "setup.openclaw.useLocalNpm",
    message: "Using local npm: /Users/wei/.openclaw/node/lib/node_modules/npm/bin/npm-cli.js",
    expected: {
      path: "/Users/wei/.openclaw/node/lib/node_modules/npm/bin/npm-cli.js",
    },
  },
  ".userNpmPrefix": {
    key: "setup.openclaw.userNpmPrefix",
    message:
      "Detected npm prefix /Users/wei/.npm-global (matches your `npm i -g`); installing openclaw there",
    expected: { path: "/Users/wei/.npm-global" },
  },
  ".userNpmPrefixMissingPath": {
    key: "setup.openclaw.userNpmPrefixMissingPath",
    message:
      "Detected npm prefix /Users/wei/.npm-global (matches your `npm i -g`); installing openclaw there",
    expected: { path: "/Users/wei/.npm-global" },
  },
  ".customNpmPrefix": {
    key: "setup.openclaw.customNpmPrefix",
    message: "Using custom npm prefix /Volumes/Tools/npm-global",
    expected: { path: "/Volumes/Tools/npm-global" },
  },
  ".localNpmPrefix (two captures)": {
    key: "setup.openclaw.localNpmPrefix",
    message:
      "User npm prefix not writable; using XDG fallback /Users/wei/.local/share/npm-global (add /Users/wei/.local/bin to your PATH to use openclaw from terminal)",
    expected: {
      path: "/Users/wei/.local/share/npm-global",
      binPath: "/Users/wei/.local/bin",
    },
  },
  ".sandboxNpmPrefix": {
    key: "setup.openclaw.sandboxNpmPrefix",
    message:
      "User npm prefix and ~/.local both unwritable; using JunQi sandbox /Users/wei/.openclaw/global",
    expected: { path: "/Users/wei/.openclaw/global" },
  },
  ".useExisting (version + path)": {
    key: "setup.openclaw.useExisting",
    message:
      "Using existing OpenClaw v2026.6.11 at /Users/wei/.local/bin/openclaw",
    expected: {
      version: "v2026.6.11",
      path: "/Users/wei/.local/bin/openclaw",
    },
  },
  ".useExisting (path only, no version)": {
    key: "setup.openclaw.useExisting",
    message: "Using existing OpenClaw at /Users/wei/.local/bin/openclaw",
    expected: { path: "/Users/wei/.local/bin/openclaw" },
  },
  ".useExisting (no path, no version → fallthrough)": {
    key: "setup.openclaw.useExisting",
    message: "Using existing local OpenClaw",
    // Both patterns fail → extractor returns null → next rule tried,
    // none match `.useExisting`, so we end up with {}.
    expected: {},
  },
  ".prepareDir": {
    key: "setup.openclaw.prepareDir",
    message: "Preparing install directory /Users/wei/.openclaw/global…",
    expected: { path: "/Users/wei/.openclaw/global" },
  },
  ".runtimeSummary": {
    key: "setup.gateway.runtimeSummary",
    message: "Runtime check done: Node.js ✓, openclaw ✓",
    expected: { summary: "Node.js ✓, openclaw ✓" },
  },
  ".portResolved": {
    key: "setup.gateway.portResolved",
    message: "Target port = 18789 (source: openclaw.json, default 18789)",
    expected: { port: "18789" },
  },
  ".alreadyUp": {
    key: "setup.gateway.alreadyUp",
    message: "Port 18789 already listening",
    expected: { port: "18789" },
  },
  ".probe": {
    key: "setup.gateway.probe",
    message: "Probing 127.0.0.1:18789 for existing Gateway listener…",
    expected: { port: "18789" },
  },
};

/**
 * Each rule in SETUP_PROGRESS_PARAM_RULES must have at least one test
 * case, so adding a new suffix without a fixture is a test failure.
 */
function suffixesForRule(rule: ParamRule): string[] {
  if (typeof rule.suffix === "string") return [rule.suffix];
  return [...rule.suffix];
}

describe("setupProgressParams", () => {
  test("returns {} for an unknown key", () => {
    assert.deepEqual(
      setupProgressI18nParams("setup.unknown.key", "anything"),
      {},
    );
  });

  test("returns {} when a matching key has an unparseable message", () => {
    assert.deepEqual(
      setupProgressI18nParams("setup.openclaw.useLocalNode", "no path here"),
      {},
    );
  });

  test("first matching rule wins (suffix ordering is significant)", () => {
    // The generic [.skip, .upgrade, .done] rule comes first. A
    // `.done` message with a Node.js version must return the version,
    // not fall through to a later rule.
    assert.deepEqual(
      setupProgressI18nParams("setup.node.done", "Detected Node.js v22.0.0"),
      { version: "v22.0.0" },
    );
  });

  for (const [label, c] of Object.entries(CASES)) {
    test(`${label}`, () => {
      assert.deepEqual(
        setupProgressI18nParams(c.key, c.message),
        c.expected,
      );
    });
  }

  test("every rule has a test case (no orphaned rules)", () => {
    // Walk the table; require at least one CASES key to mention each
    // rule's suffix(es). This catches a new rule added without a
    // matching fixture.
    const labels = Object.keys(CASES);
    for (const rule of SETUP_PROGRESS_PARAM_RULES) {
      const suffixes = suffixesForRule(rule);
      const covered = suffixes.some((s) =>
        labels.some((label) => label.includes(s)),
      );
      assert.ok(
        covered,
        `Rule with suffix ${JSON.stringify(suffixes)} has no test case. Add one to setupProgressParams.test.ts.`,
      );
    }
  });
});
