import assert from "node:assert/strict";
import test from "node:test";
import { CommandHandlerRegistry } from "./command-handler-registry.js";
import type { CommandRecord } from "./types.js";

const command = (kind: CommandRecord["kind"]): CommandRecord => ({
  id: `command-${kind.toLowerCase()}`,
  runId: "run-1",
  kind,
  entityId: null,
  payload: {},
  effectKey: `effect-${kind.toLowerCase()}`,
  status: "LEASED",
  availableAt: 0,
  attempts: 1,
  failureCount: 0,
  effectStartedAt: null,
  leaseOwner: "worker-1",
  leaseExpiresAt: Date.now() + 60_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test("command handler registry executes a typed handler and preserves its settle decision", async () => {
  const seen: string[] = [];
  const registry = CommandHandlerRegistry.partial([
    ["PLAN", async (value) => {
      seen.push(value.id);
      return true;
    }],
  ]);

  assert.equal(registry.has("PLAN"), true);
  assert.equal(await registry.execute(command("PLAN")), true);
  assert.deepEqual(seen, ["command-plan"]);
});

test("command handler registry rejects duplicate or unsupported registrations", () => {
  assert.throws(
    () => new CommandHandlerRegistry([
      ["PLAN", () => false],
      ["PLAN", () => false],
    ]),
    /Duplicate collaboration command handler: PLAN/,
  );

  assert.throws(
    () => new CommandHandlerRegistry([["PLAN", () => false]]),
    /Missing collaboration command handlers: PROVISION/,
  );

  assert.throws(
    () => new CommandHandlerRegistry([["UNKNOWN" as CommandRecord["kind"], () => false]]),
    /Unsupported collaboration command kind: UNKNOWN/,
  );
});

test("command handler registry fails closed for missing handlers and invalid settle decisions", async () => {
  const missing = CommandHandlerRegistry.partial([]);
  await assert.rejects(
    missing.execute(command("DELETE")),
    /No collaboration command handler registered for DELETE/,
  );

  const invalid = CommandHandlerRegistry.partial([
    ["DELETE", () => "succeeded" as unknown as boolean],
  ]);
  await assert.rejects(
    invalid.execute(command("DELETE")),
    /returned a non-boolean settle decision/,
  );
});
