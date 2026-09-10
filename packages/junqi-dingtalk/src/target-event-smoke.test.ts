import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DwsRunner } from "./dws-runner.js";
import { DingTalkRuntimeError } from "./errors.js";
import { DingTalkEventRuntime, type DingTalkEventSnapshot } from "./event-runtime.js";
import {
  buildDingTalkTargetEventConfig,
  DINGTALK_TARGET_EVENT_SMOKE_ACKNOWLEDGEMENT,
  parseDingTalkTargetEventSmokeArguments,
  runDingTalkTargetEventSmoke,
} from "./target-event-smoke.js";

function argumentsList(): string[] {
  return [
    "--dws-path",
    "/opt/dws",
    "--profile",
    "corp:user",
    "--event-key",
    "user_todo_task_update",
    "--wait-seconds",
    "30",
    "--role-types",
    "executor,participant",
    "--acknowledge-subscription",
    DINGTALK_TARGET_EVENT_SMOKE_ACKNOWLEDGEMENT,
  ];
}

function snapshot(
  overrides: Partial<DingTalkEventSnapshot> = {},
): DingTalkEventSnapshot {
  return {
    configured: true,
    phase: "running",
    profileRef: "corp:user",
    subscriptionCount: 1,
    activeConsumerCount: 1,
    readyConsumerCount: 1,
    eventKeys: ["user_todo_task_update"],
    contractDigest: "a".repeat(64),
    latestSequence: 1,
    oldestSequence: 1,
    droppedCount: 0,
    rejectedCount: 0,
    lastError: null,
    events: [{
      sequence: 1,
      receivedAt: "2026-09-09T00:00:00.000Z",
      profileRef: "corp:user",
      eventType: "user_todo_task_update",
      eventId: "private-event-id",
      payload: { private: "business payload" },
    }],
    ...overrides,
  };
}

test("目标租户事件验收参数要求显式确认、精确 Profile 和有限等待", () => {
  const parsed = parseDingTalkTargetEventSmokeArguments(argumentsList());
  assert.deepEqual(parsed, {
    dwsPath: "/opt/dws",
    profile: "corp:user",
    eventKey: "user_todo_task_update",
    waitSeconds: 30,
    roleTypes: ["executor", "participant"],
  });
  assert.deepEqual(buildDingTalkTargetEventConfig(parsed), {
    profile: "corp:user",
    bufferSize: 20,
    subscriptions: [{
      eventKeys: ["user_todo_task_update"],
      roleTypes: ["executor", "participant"],
    }],
  });
  assert.throws(
    () => parseDingTalkTargetEventSmokeArguments(argumentsList().slice(0, -2)),
    /required argument is missing/,
  );
  assert.throws(
    () => parseDingTalkTargetEventSmokeArguments([
      ...argumentsList().slice(0, -1),
      "event-read-only",
    ]),
    /acknowledgement is invalid/,
  );
  assert.throws(
    () => parseDingTalkTargetEventSmokeArguments(
      argumentsList().flatMap((value) => value === "30" ? ["301"] : [value]),
    ),
    /between 5 and 300/,
  );
  assert.throws(
    () => buildDingTalkTargetEventConfig({
      ...parsed,
      eventKey: "user_im_message_receive_user",
    }),
    /User-scoped IM events require exactly one user identity field/,
  );
});

test("目标租户事件验收只在 ready、事件缓存和通知一致时通过", async () => {
  let stopped = 0;
  const current = snapshot();
  const result = await runDingTalkTargetEventSmoke({
    async start(context) {
      context.gatewayEvents.emit(
        "events_changed",
        { revision: 1, eventType: "user_todo_task_update" },
        { scope: "operator.read" },
      );
    },
    async stop() { stopped += 1; },
    snapshot() {
      return stopped > 0
        ? { ...current, phase: "stopped", activeConsumerCount: 0, readyConsumerCount: 0 }
        : current;
    },
  }, 5);

  assert.equal(stopped, 1);
  assert.deepEqual(result, {
    status: "verified",
    checkedContractCount: 1,
    readyConsumerCount: 1,
    receivedEventCount: 1,
    notificationCount: 1,
    latestSequence: 1,
    contractDigest: "a".repeat(64),
    rejectedCount: 0,
    droppedCount: 0,
    eventType: "user_todo_task_update",
    recovery: "none",
  });
  assert.doesNotMatch(JSON.stringify(result), /corp:user|private-event-id|business payload/);
});

test("目标租户事件验收通过真实进程边界完成契约、ready、通知和停止", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-target-event-smoke-"));
  const entry = path.join(directory, "dws.js");
  const schema = {
    availability: "available",
    canonical_path: "event.consume",
    cli_path: "event consume",
    effect: "write",
    risk: "medium",
    confirmation: "not_required",
    idempotency: "non_idempotent",
    parameters: {
      flatten: { type: "boolean" },
      format: { type: "string" },
      user: { type: "string" },
      "open-dingtalk-id": { type: "string" },
      group: { type: "string" },
      "role-types": { type: "array" },
    },
  };
  await writeFile(entry, [
    `if(process.argv.includes('schema')){process.stdout.write(${JSON.stringify(JSON.stringify(schema))});process.exit(0);}`,
    "process.stdin.resume();",
    "process.stderr.write('[event] ready event_key=user_oa_approval_task_created bus_pid=21 subscribe_id=sub-target\\n');",
    "setTimeout(() => process.stdout.write(JSON.stringify({type:'user_oa_approval_task_created',event_id:'private-target-event'})+'\\n'), 10);",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n"));
  const input = parseDingTalkTargetEventSmokeArguments([
    "--dws-path",
    entry,
    "--profile",
    "corp:user",
    "--event-key",
    "user_oa_approval_task_created",
    "--wait-seconds",
    "5",
    "--acknowledge-subscription",
    DINGTALK_TARGET_EVENT_SMOKE_ACKNOWLEDGEMENT,
  ]);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, buildDingTalkTargetEventConfig(input));
  try {
    const startedAt = Date.now();
    const result = await runDingTalkTargetEventSmoke(runtime, 5_000);
    assert.ok(Date.now() - startedAt < 2_000);
    assert.equal(result.status, "verified");
    assert.equal(result.checkedContractCount, 1);
    assert.equal(result.readyConsumerCount, 1);
    assert.equal(result.receivedEventCount, 1);
    assert.equal(result.notificationCount, 1);
    assert.equal(result.eventType, "user_oa_approval_task_created");
    assert.doesNotMatch(JSON.stringify(result), /corp:user|private-target-event/);
    assert.equal(runtime.snapshot().phase, "stopped");
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("目标租户事件验收将 ready 后无事件保留为未通过", async () => {
  let stopped = 0;
  const result = await runDingTalkTargetEventSmoke({
    async start() {},
    async stop() { stopped += 1; },
    snapshot() {
      return snapshot({
        phase: stopped > 0 ? "stopped" : "running",
        activeConsumerCount: stopped > 0 ? 0 : 1,
        readyConsumerCount: stopped > 0 ? 0 : 1,
        latestSequence: 0,
        oldestSequence: null,
        events: [],
      });
    },
  }, 5);

  assert.equal(stopped, 1);
  assert.equal(result.status, "ready_no_event");
  assert.equal(result.readyConsumerCount, 1);
  assert.equal(result.receivedEventCount, 0);
  assert.equal(result.recovery, "trigger_event_and_retry");
});

test("目标租户事件验收不把拒绝过事件的降级运行时误报为等待事件", async () => {
  let stopped = false;
  const result = await runDingTalkTargetEventSmoke({
    async start() {},
    async stop() { stopped = true; },
    snapshot() {
      return snapshot({
        phase: stopped ? "stopped" : "degraded",
        activeConsumerCount: stopped ? 0 : 1,
        readyConsumerCount: stopped ? 0 : 1,
        latestSequence: 0,
        oldestSequence: null,
        rejectedCount: 1,
        events: [],
      });
    },
  }, 5);

  assert.equal(result.status, "invalid_notice");
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.recovery, "inspect_event_protocol_before_retry");
});

test("目标租户事件验收在启动失败时清理并输出脱敏错误", async () => {
  let stopped = 0;
  const result = await runDingTalkTargetEventSmoke({
    async start() {
      throw new DingTalkRuntimeError("DWS_EVENT_STARTUP_TIMEOUT", "private startup detail");
    },
    async stop() { stopped += 1; },
    snapshot() {
      return snapshot({
        phase: stopped > 0 ? "stopped" : "degraded",
        activeConsumerCount: 0,
        readyConsumerCount: 0,
        contractDigest: null,
        latestSequence: 0,
        oldestSequence: null,
        events: [],
      });
    },
  }, 5);

  assert.equal(stopped, 1);
  assert.equal(result.status, "failed_before_ready");
  assert.equal(result.recovery, "fix_runtime_or_permissions_before_retry");
  assert.deepEqual(result.error, {
    code: "DWS_EVENT_STARTUP_TIMEOUT",
    message: "DWS event consumer startup timed out",
  });
  assert.doesNotMatch(JSON.stringify(result), /private startup detail/);
});

test("目标租户事件验收拒绝不一致通知并将停止失败置为最高优先级", async () => {
  let inconsistentStopped = false;
  const inconsistent = await runDingTalkTargetEventSmoke({
    async start(context) {
      context.gatewayEvents.emit(
        "events_changed",
        { revision: 2, eventType: "user_todo_task_update" },
        { scope: "operator.read" },
      );
    },
    async stop() { inconsistentStopped = true; },
    snapshot() {
      return inconsistentStopped
        ? snapshot({ phase: "stopped", activeConsumerCount: 0, readyConsumerCount: 0 })
        : snapshot();
    },
  }, 5);
  assert.equal(inconsistent.status, "invalid_notice");
  assert.equal(inconsistent.recovery, "inspect_event_protocol_before_retry");

  const stopFailure = await runDingTalkTargetEventSmoke({
    async start(context) {
      context.gatewayEvents.emit(
        "events_changed",
        { revision: 1, eventType: "user_todo_task_update" },
        { scope: "operator.read" },
      );
    },
    async stop() {
      throw new DingTalkRuntimeError("DWS_EVENT_STOP_TIMEOUT", "private stop detail");
    },
    snapshot() { return snapshot(); },
  }, 5);
  assert.equal(stopFailure.status, "stop_unverified");
  assert.equal(stopFailure.recovery, "inspect_subscription_before_retry");
  assert.deepEqual(stopFailure.error, {
    code: "DWS_EVENT_STOP_TIMEOUT",
    message: "DWS event consumer shutdown timed out",
  });
});
