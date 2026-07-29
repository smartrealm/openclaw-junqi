import assert from "node:assert/strict";
import test from "node:test";
import {
  GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE,
  GatewayTransportLifecycleError,
} from "@/services/gateway/GatewayTransportError";
import { handleUnhandledPromiseRejection } from "./globalErrorPolicy";

function dispatch(reason: unknown) {
  let prevented = false;
  const fatal: Array<{ title: string; detail: unknown }> = [];
  const outcome = handleUnhandledPromiseRejection(
    {
      reason,
      preventDefault: () => { prevented = true; },
    },
    (title, detail) => fatal.push({ title, detail }),
  );
  return { fatal, outcome, prevented };
}

test("Gateway transport lifecycle rejection stays in the connection status UI", () => {
  const result = dispatch(new GatewayTransportLifecycleError());

  assert.equal(result.outcome, "gateway-recoverable");
  assert.equal(result.prevented, true);
  assert.deepEqual(result.fatal, []);
});

test("structurally tagged Gateway lifecycle errors survive module boundaries", () => {
  const result = dispatch({
    code: GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE,
    message: "Gateway connection closed",
  });

  assert.equal(result.outcome, "gateway-recoverable");
  assert.equal(result.prevented, true);
  assert.deepEqual(result.fatal, []);
});

test("plain and unrelated promise failures remain fatal", () => {
  const plainGatewayText = dispatch(new Error("Gateway connection closed"));
  const programmingFailure = dispatch(new TypeError("invalid child"));

  assert.equal(plainGatewayText.outcome, "fatal");
  assert.equal(plainGatewayText.prevented, false);
  assert.equal(plainGatewayText.fatal[0]?.title, "Promise Rejection");
  assert.match(String(plainGatewayText.fatal[0]?.detail), /Gateway connection closed/);
  assert.equal(programmingFailure.outcome, "fatal");
  assert.match(String(programmingFailure.fatal[0]?.detail), /invalid child/);
});
