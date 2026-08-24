import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { registerOpenClawAdapter } from "./index.js";

type RegisteredHandler = (context: {
  params: Record<string, unknown>;
  respond: (ok: boolean, result?: unknown, error?: unknown) => void;
}) => Promise<void>;

test("unknown schema startup failure remains available through the registered RPC without rewriting data", async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "junqi-collab-startup-"));
  const dataDir = path.join(stateDir, "junqi-collab");
  const databasePath = path.join(dataDir, "collaboration.sqlite");
  mkdirSync(dataDir, { recursive: true });
  const setup = new DatabaseSync(databasePath);
  setup.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO metadata(key, value, updated_at)
    VALUES ('schema_version', '11', 1);
  `);
  setup.close();

  const handlers = new Map<string, RegisteredHandler>();
  let service: { start(context: { stateDir: string; logger: unknown }): Promise<void> } | null = null;
  registerOpenClawAdapter({
    registrationMode: "full",
    pluginConfig: {},
    runtime: {},
    agent: { events: { emitAgentEvent() {} } },
    logger: { warn() {} },
    registerGatewayMethod(method: string, handler: RegisteredHandler) {
      handlers.set(method, handler);
    },
    registerService(nextService: typeof service) {
      service = nextService;
    },
  } as never);

  try {
    assert.ok(service);
    await assert.rejects(
      service.start({ stateDir, logger: {} }),
      /database schema 11 is unsupported; expected 15/,
    );

    const responses: Array<{ ok: boolean; result?: unknown; error?: unknown }> = [];
    await handlers.get("junqi.collab.capabilities")!({
      params: {},
      respond(ok, result, error) {
        responses.push({ ok, result, error });
      },
    });
    assert.deepEqual(responses, [{
      ok: false,
      result: undefined,
      error: {
        code: "DATABASE_SCHEMA_UNSUPPORTED",
        message: "The collaboration database schema is not supported by this plugin",
        details: { actualSchemaVersion: 11, expectedSchemaVersion: 15 },
      },
    }]);

    const inspected = new DatabaseSync(databasePath, { readOnly: true });
    const row = inspected.prepare(
      "SELECT value FROM metadata WHERE key = 'schema_version'",
    ).get() as { value: string };
    inspected.close();
    assert.equal(row.value, "11");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
