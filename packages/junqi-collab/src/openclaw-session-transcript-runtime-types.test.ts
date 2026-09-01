import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as ts from "typescript";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DECLARATION_FILE = path.join(SOURCE_DIRECTORY, "openclaw-session-transcript-runtime.d.ts");
const TRANSCRIPT_MODULE = "openclaw/plugin-sdk/session-transcript-runtime";

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    .join("\n");
}

test("补充声明可独立覆盖只有 JavaScript 入口的 OpenClaw transcript 子路径", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "junqi-transcript-types-"));
  try {
    const openClawRoot = path.join(fixtureRoot, "node_modules", "openclaw");
    const sdkRoot = path.join(openClawRoot, "dist", "plugin-sdk");
    await mkdir(sdkRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(fixtureRoot, "package.json"), '{"type":"module"}\n'),
      writeFile(
        path.join(openClawRoot, "package.json"),
        JSON.stringify({
          name: "openclaw",
          type: "module",
          exports: {
            "./plugin-sdk/plugin-entry": {
              types: "./dist/plugin-sdk/plugin-entry.d.ts",
              default: "./dist/plugin-sdk/plugin-entry.js",
            },
            "./plugin-sdk/session-transcript-runtime": {
              default: "./dist/plugin-sdk/session-transcript-runtime.js",
            },
          },
        }),
      ),
      writeFile(
        path.join(sdkRoot, "plugin-entry.d.ts"),
        "export interface OpenClawConfig { agents?: unknown; }\n",
      ),
      writeFile(path.join(sdkRoot, "plugin-entry.js"), "export {};\n"),
      writeFile(
        path.join(sdkRoot, "session-transcript-runtime.js"),
        "export function readSessionTranscriptEvents() {}\nexport function appendAssistantMirrorMessageByIdentity() {}\n",
      ),
    ]);

    const declarationPath = path.join(fixtureRoot, "session-transcript-runtime.d.ts");
    const consumerPath = path.join(fixtureRoot, "consumer.ts");
    await Promise.all([
      writeFile(declarationPath, await readFile(DECLARATION_FILE, "utf8")),
      writeFile(
        consumerPath,
        `import { appendAssistantMirrorMessageByIdentity, readSessionTranscriptEvents } from "${TRANSCRIPT_MODULE}";\n`
          + "const events = await readSessionTranscriptEvents({ sessionId: 'session', sessionKey: 'agent:main:main' });\n"
          + "const result = await appendAssistantMirrorMessageByIdentity({ sessionId: 'session', sessionKey: 'agent:main:main', text: 'result' });\n"
          + "const first: unknown = events[0];\n"
          + "const accepted: boolean = result.ok;\n"
          + "void first;\nvoid accepted;\n",
      ),
    ]);

    const program = ts.createProgram({
      rootNames: [declarationPath, consumerPath],
      options: {
        exactOptionalPropertyTypes: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics));
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});
