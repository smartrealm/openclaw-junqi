import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError, RequestValidationError } from "./errors.js";
import { COLLABORATION_RPC_METHODS, registerCollaborationRpc } from "./rpc.js";
import type { CollaborationService } from "./service.js";
import {
  parseJsonObject,
  parseJsonText,
  readInteger,
  readOptionalString,
  readString,
} from "./util.js";

type RegisteredHandler = (context: {
  params: Record<string, unknown>;
  respond: (ok: boolean, result?: unknown, error?: unknown) => void;
}) => Promise<void>;

const UNKNOWN_ERROR_MESSAGE_FOR_TEST = "JunQi collaboration operation failed";

function registeredRpc(getService: () => CollaborationService | null) {
  const handlers = new Map<string, { handler: RegisteredHandler; scope: string }>();
  registerCollaborationRpc({
    registerGatewayMethod(method: string, handler: RegisteredHandler, options: { scope: string }) {
      handlers.set(method, { handler, scope: options.scope });
    },
  } as never, getService);
  return handlers;
}

function respondingInvocation(handler: RegisteredHandler, params: Record<string, unknown>) {
  const responses: Array<{ ok: boolean; result?: unknown; error?: unknown }> = [];
  return handler({
    params,
    respond(ok, result, error) {
      responses.push({ ok, result, error });
    },
  }).then(() => responses);
}

test("all collaboration RPC methods register once with their declared operator scope", () => {
  const handlers = registeredRpc(() => null);
  assert.equal(handlers.size, COLLABORATION_RPC_METHODS.length);
  assert.equal(new Set(COLLABORATION_RPC_METHODS.map((definition) => definition.method)).size, handlers.size);
  for (const definition of COLLABORATION_RPC_METHODS) {
    assert.equal(handlers.get(definition.method)?.scope, definition.scope, definition.method);
  }
});

test("every collaboration RPC fails closed while the plugin service is unavailable", async () => {
  const handlers = registeredRpc(() => null);
  for (const definition of COLLABORATION_RPC_METHODS) {
    const responses = await respondingInvocation(handlers.get(definition.method)!.handler, {});
    assert.deepEqual(responses, [{
      ok: false,
      result: undefined,
      error: {
        code: "UNAVAILABLE",
        message: "JunQi collaboration service is not running",
      },
    }], definition.method);
  }
});

test("every registered RPC reaches its service handler and responds exactly once", async () => {
  const calls: Array<{ property: string; args: unknown[] }> = [];
  const service = new Proxy({}, {
    get(_target, property) {
      return (...args: unknown[]) => {
        calls.push({ property: String(property), args });
        return { property: String(property), marker: (args[0] as Record<string, unknown> | undefined)?.marker };
      };
    },
  }) as CollaborationService;
  const handlers = registeredRpc(() => service);
  for (const definition of COLLABORATION_RPC_METHODS) {
    const responses = await respondingInvocation(
      handlers.get(definition.method)!.handler,
      { marker: definition.method },
    );
    assert.equal(responses.length, 1, definition.method);
    assert.equal(responses[0]!.ok, true, definition.method);
  }
  assert.equal(calls.length, COLLABORATION_RPC_METHODS.length);
});

test("RPC errors preserve collaboration details and redact unknown error messages", async () => {
  const collaborationFailure = new Proxy({}, {
    get() {
      return () => {
        throw new CollaborationError("REVISION_CONFLICT", "revision changed", { expected: 4, actual: 5 });
      };
    },
  }) as CollaborationService;
  const collaborationHandlers = registeredRpc(() => collaborationFailure);
  const collaborationResponses = await respondingInvocation(
    collaborationHandlers.get("junqi.collab.run.get")!.handler,
    { runId: "run-1" },
  );
  assert.deepEqual(collaborationResponses, [{
    ok: false,
    result: undefined,
    error: {
      code: "REVISION_CONFLICT",
      message: "revision changed",
      details: { expected: 4, actual: 5 },
    },
  }]);

  const unknownFailure = new Proxy({}, {
    get() {
      return () => {
        throw new TypeError("unexpected adapter failure token=super-secret-value");
      };
    },
  }) as CollaborationService;
  const unknownHandlers = registeredRpc(() => unknownFailure);
  const unknownResponses = await respondingInvocation(
    unknownHandlers.get("junqi.collab.capabilities")!.handler,
    {},
  );
  assert.deepEqual(unknownResponses, [{
    ok: false,
    result: undefined,
    error: {
      code: "INTERNAL_ERROR",
      message: "JunQi collaboration operation failed",
    },
  }]);
  assert.equal(JSON.stringify(unknownResponses).includes("super-secret-value"), false);
});

test("RPC maps only explicit request validation failures to INVALID_REQUEST", async () => {
  const validationFailures: Array<{ name: string; expectedMessage: string; invoke: () => unknown }> = [
    {
      name: "parseJsonObject",
      expectedMessage: "params must be an object",
      invoke: () => parseJsonObject(null, "params"),
    },
    {
      name: "readString",
      expectedMessage: "runId must be a non-empty string",
      invoke: () => readString(undefined, "runId"),
    },
    {
      name: "readOptionalString",
      expectedMessage: "format must be a non-empty string",
      invoke: () => readOptionalString(42, "format"),
    },
    {
      name: "readInteger",
      expectedMessage: "limit must be an integer",
      invoke: () => readInteger(1.5, "limit"),
    },
    {
      name: "parseJsonText",
      expectedMessage: "Agent response did not contain a JSON object",
      invoke: () => parseJsonText("not-json"),
    },
  ];

  for (const scenario of validationFailures) {
    const service = new Proxy({}, {
      get() {
        return scenario.invoke;
      },
    }) as CollaborationService;
    const handlers = registeredRpc(() => service);
    const responses = await respondingInvocation(
      handlers.get("junqi.collab.run.get")!.handler,
      {},
    );

    assert.deepEqual(responses, [{
      ok: false,
      result: undefined,
      error: {
        code: "INVALID_REQUEST",
        message: scenario.expectedMessage,
      },
    }], scenario.name);
    assert.equal(JSON.stringify(responses).includes(UNKNOWN_ERROR_MESSAGE_FOR_TEST), false, scenario.name);
  }

  assert.throws(
    () => readString(undefined, "runId"),
    (error: unknown) => error instanceof RequestValidationError && error.code === "INVALID_REQUEST",
  );
});
