import assert from "node:assert/strict";
import test from "node:test";
import {
  DINGTALK_EVENT_SNAPSHOT_RPC_METHOD,
  parseDingTalkEventSnapshotRpcParams,
  projectDingTalkEventOperatorSnapshot,
  registerDingTalkEventSnapshotRpc,
} from "./event-rpc.js";
import type { DingTalkEventSnapshot } from "./event-runtime.js";

function runtimeSnapshot(): DingTalkEventSnapshot {
  return {
    runtimeGeneration: "11111111-1111-4111-8111-111111111111",
    configurationDigest: "b".repeat(64),
    configured: true,
    phase: "running",
    profileRef: "corp:user",
    subscriptionCount: 1,
    activeConsumerCount: 1,
    readyConsumerCount: 1,
    eventKeys: ["user_todo_task_update", "user_todo_task_update"],
    contractDigest: "a".repeat(64),
    latestSequence: 8,
    oldestSequence: 7,
    droppedCount: 2,
    rejectedCount: 1,
    lastError: { code: "DWS_EVENT_PROTOCOL_INVALID", message: "redacted" },
    events: [{
      sequence: 8,
      receivedAt: "2026-09-09T08:00:00.000Z",
      profileRef: "corp:user",
      eventType: "user_todo_task_update",
      eventId: "event-secret",
      payload: { type: "user_todo_task_update", content: "business-secret" },
    }],
  };
}

test("事件快照 RPC 参数闭合且限制返回数量", () => {
  assert.deepEqual(parseDingTalkEventSnapshotRpcParams({}), {
    afterSequence: 0,
    limit: 20,
  });
  assert.deepEqual(parseDingTalkEventSnapshotRpcParams({ afterSequence: 7, limit: 1 }), {
    afterSequence: 7,
    limit: 1,
  });
  for (const value of [
    null,
    [],
    { extra: true },
    { afterSequence: -1 },
    { afterSequence: 1.5 },
    { limit: 0 },
    { limit: 21 },
  ]) {
    assert.throws(() => parseDingTalkEventSnapshotRpcParams(value), /request is invalid/u);
  }
});

test("操作员事件投影不暴露 Profile 之外的事件身份和业务载荷", () => {
  const projected = projectDingTalkEventOperatorSnapshot(runtimeSnapshot());
  assert.equal(projected.runtimeGeneration, "11111111-1111-4111-8111-111111111111");
  assert.equal(projected.configurationDigest, "b".repeat(64));
  assert.deepEqual(projected.events, [{
    sequence: 8,
    receivedAt: "2026-09-09T08:00:00.000Z",
    eventType: "user_todo_task_update",
  }]);
  assert.equal(projected.lastErrorCode, "DWS_EVENT_PROTOCOL_INVALID");
  assert.deepEqual(projected.eventKeys, ["user_todo_task_update"]);
  assert.doesNotMatch(JSON.stringify(projected), /event-secret|business-secret|redacted/u);
});

test("事件快照注册为 operator.read 并返回当前运行时投影", async () => {
  let registration: {
    method: string;
    scope: string;
    profileAccess: string | undefined;
    handler: (context: {
      params: Record<string, unknown>;
      respond: (ok: boolean, result?: unknown, error?: unknown) => void;
    }) => void | Promise<void>;
  } | null = null;
  const requests: Array<{ afterSequence: number; limit: number }> = [];
  registerDingTalkEventSnapshotRpc({
    registerGatewayMethod(method, handler, options) {
      registration = {
        method,
        handler,
        scope: options?.scope ?? "operator.admin",
        profileAccess: options?.profileAccess,
      };
    },
  } as never, {
    snapshot(afterSequence, limit) {
      requests.push({ afterSequence, limit });
      return runtimeSnapshot();
    },
  });
  if (!registration) throw new Error("事件快照 RPC 未注册");
  const registered = registration as NonNullable<typeof registration>;
  assert.equal(registered.method, DINGTALK_EVENT_SNAPSHOT_RPC_METHOD);
  assert.equal(registered.scope, "operator.read");
  assert.equal(registered.profileAccess, "required");

  const responses: Array<{ ok: boolean; result?: unknown; error?: unknown }> = [];
  await registered.handler({
    params: { afterSequence: 7, limit: 2 },
    respond(ok, result, error) {
      responses.push({ ok, result, error });
    },
  });
  assert.deepEqual(requests, [{ afterSequence: 7, limit: 2 }]);
  assert.equal(responses[0]?.ok, true);
  assert.deepEqual((responses[0]?.result as { events: unknown }).events, [{
    sequence: 8,
    receivedAt: "2026-09-09T08:00:00.000Z",
    eventType: "user_todo_task_update",
  }]);

  await registered.handler({
    params: { limit: 50 },
    respond(ok, result, error) {
      responses.push({ ok, result, error });
    },
  });
  assert.deepEqual(responses[1], {
    ok: false,
    result: undefined,
    error: {
      code: "DINGTALK_EVENT_SNAPSHOT_REQUEST_INVALID",
      message: "DingTalk event snapshot request is invalid",
    },
  });
});

test("事件快照运行时失败不冒充请求参数错误且不泄漏原始异常", async () => {
  let handler: ((context: {
    params: Record<string, unknown>;
    respond: (ok: boolean, result?: unknown, error?: unknown) => void;
  }) => void | Promise<void>) | null = null;
  registerDingTalkEventSnapshotRpc({
    registerGatewayMethod(_method, candidate) {
      handler = candidate;
    },
  } as never, {
    snapshot() {
      throw new Error("secret runtime detail");
    },
  });
  if (!handler) throw new Error("事件快照 RPC 未注册");
  const responses: Array<{ ok: boolean; result?: unknown; error?: unknown }> = [];
  await (handler as NonNullable<typeof handler>)({
    params: {},
    respond(ok, result, error) {
      responses.push({ ok, result, error });
    },
  });
  assert.deepEqual(responses, [{
    ok: false,
    result: undefined,
    error: {
      code: "DINGTALK_EVENT_SNAPSHOT_FAILED",
      message: "DingTalk event snapshot is unavailable",
    },
  }]);
  assert.doesNotMatch(JSON.stringify(responses), /secret runtime detail/u);
});
