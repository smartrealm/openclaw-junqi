import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DwsRunner } from "./dws-runner.js";
import { DingTalkRuntimeError } from "./errors.js";
import {
  buildDwsEventArguments,
  canonicalDingTalkEventConfiguration,
  DINGTALK_GATEWAY_EVENT_NAME,
  digestDingTalkEventConfiguration,
  DingTalkEventRuntime,
  normalizeDingTalkEventConfig,
  verifyDwsEventConsumeContract,
} from "./event-runtime.js";

const EVENT_CONSUME_SCHEMA = {
  availability: "available",
  canonical_path: "event.consume",
  cli_path: "event consume",
  effect: "write",
  risk: "medium",
  confirmation: "not_required",
  idempotency: "non_idempotent",
  parameters: {
    flatten: { type: "boolean", required: false },
    format: { type: "string", required: false },
    user: { type: "string", required: false },
    "open-dingtalk-id": { type: "string", required: false },
    group: { type: "string", required: false },
    "role-types": { type: "array", required: false },
  },
};

function schemaPrelude(schema: unknown = EVENT_CONSUME_SCHEMA): string {
  return `if(process.argv.includes('schema')){process.stdout.write(${JSON.stringify(JSON.stringify(schema))});process.exit(0);}`;
}

test("事件配置拒绝跨类别、缺少目标和重复订阅", () => {
  assert.throws(
    () => normalizeDingTalkEventConfig({
      eventProfile: "corp-a:user-a",
      eventSubscriptions: [{
        eventKeys: ["user_oa_approval_task_created", "user_todo_task_create"],
      }],
    }),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_EVENT_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => normalizeDingTalkEventConfig({
      eventProfile: "corp-a:user-a",
      eventSubscriptions: [{ eventKeys: ["user_im_message_receive_user"] }],
    }),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_EVENT_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => normalizeDingTalkEventConfig({
      eventProfile: "corp-a:user-a",
      eventSubscriptions: [
        { eventKeys: ["user_oa_approval_task_created"] },
        { eventKeys: ["user_oa_approval_task_created"] },
      ],
    }),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_EVENT_CONFIGURATION_INVALID",
  );
});

test("事件命令固定 Profile、扁平 NDJSON 和目标参数", () => {
  assert.deepEqual(buildDwsEventArguments("corp-a:user-a", {
    eventKeys: ["user_todo_task_create", "user_todo_task_update"],
    roleTypes: ["executor"],
  }), [
    "--profile",
    "corp-a:user-a",
    "event",
    "consume",
    "user_todo_task_create",
    "user_todo_task_update",
    "--role-types",
    "executor",
    "--flatten",
    "--format",
    "ndjson",
  ]);
});

test("事件配置摘要覆盖 Profile、缓冲区、订阅目标和角色", () => {
  const config = normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventBufferSize: 80,
    eventSubscriptions: [{
      eventKeys: ["user_todo_task_create", "user_todo_task_update"],
      roleTypes: ["executor"],
    }],
  });
  assert.equal(
    canonicalDingTalkEventConfiguration(config),
    '["corp-a:user-a",80,[[["user_todo_task_create","user_todo_task_update"],null,null,null,["executor"]]]]',
  );
  assert.equal(
    digestDingTalkEventConfiguration(config),
    "ff14af01376eeb43734e0849a808b6d30bdeba93a1bfb4ce3e5c87f16fd64ca3",
  );
  assert.notEqual(
    digestDingTalkEventConfiguration(config),
    digestDingTalkEventConfiguration({ ...config, bufferSize: 81 }),
  );
  assert.notEqual(
    digestDingTalkEventConfiguration(config),
    digestDingTalkEventConfiguration({
      ...config,
      subscriptions: [{ ...config.subscriptions[0]!, roleTypes: ["participant"] }],
    }),
  );
});

test("事件运行时在订阅前失败关闭核验 DWS consume 契约", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-schema-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, schemaPrelude({ ...EVENT_CONSUME_SCHEMA, risk: "high" }));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  try {
    await assert.rejects(
      verifyDwsEventConsumeContract(runner),
      (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_SCHEMA_DRIFT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("事件运行时拒绝启动上游标记为不可用的消费契约", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-unavailable-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, schemaPrelude({ ...EVENT_CONSUME_SCHEMA, availability: "unavailable" }));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  try {
    await assert.rejects(
      verifyDwsEventConsumeContract(runner),
      (error) => error instanceof DingTalkRuntimeError
        && error.code === "DWS_SCHEMA_DRIFT"
        && error.details?.fields?.includes("availability"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("事件运行时等待 ready、去重、有界缓冲并优雅停止", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, [
    schemaPrelude(),
    "process.stdin.resume();",
    "process.stdout.write(JSON.stringify({type:'user_oa_approval_task_created',event_id:'one'})+'\\n');",
    "setTimeout(() => {",
    "  process.stderr.write('[event] ready event_key=user_oa_approval_task_created bus_pid=7 subscribe_id=sub-a\\n');",
    "  process.stdout.write(JSON.stringify({type:'user_oa_approval_task_created',event_id:'one'})+'\\n');",
    "  process.stdout.write(JSON.stringify({type:'user_oa_approval_task_created',event_id:'two'})+'\\n');",
    "  process.stdout.write(JSON.stringify({type:'user_oa_approval_task_created',event_id:'three'})+'\\n');",
    "}, 10);",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n"));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventBufferSize: 2,
    eventSubscriptions: [{ eventKeys: ["user_oa_approval_task_created"] }],
  }));
  const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
  let cleared = 0;
  try {
    await runtime.start({
      serviceHealth: {
        clearFailure() { cleared += 1; },
        reportFailure() {},
      },
      gatewayEvents: {
        emit(event, payload, options) {
          assert.match(event, /^[a-z][a-z0-9_-]*$/u);
          assert.deepEqual(options, { scope: "operator.read" });
          emitted.push({ event, payload });
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = runtime.snapshot(0, 20);
    assert.equal(snapshot.phase, "running");
    assert.equal(snapshot.activeConsumerCount, 1);
    assert.equal(snapshot.readyConsumerCount, 1);
    assert.match(snapshot.contractDigest ?? "", /^[a-f0-9]{64}$/);
    assert.match(
      snapshot.runtimeGeneration,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    assert.match(snapshot.configurationDigest, /^[a-f0-9]{64}$/u);
    assert.equal(snapshot.latestSequence, 3);
    assert.equal(snapshot.oldestSequence, 2);
    assert.equal(snapshot.droppedCount, 1);
    assert.deepEqual(snapshot.events.map((event) => event.eventId), ["two", "three"]);
    assert.equal(emitted.length, 3);
    assert.deepEqual(emitted.map((item) => item.event), [
      DINGTALK_GATEWAY_EVENT_NAME,
      DINGTALK_GATEWAY_EVENT_NAME,
      DINGTALK_GATEWAY_EVENT_NAME,
    ]);
    assert.deepEqual(emitted.map((item) => item.payload.revision), [1, 2, 3]);
    assert.ok(emitted.every((item) => (
      item.payload.runtimeGeneration === snapshot.runtimeGeneration
      && item.payload.configurationDigest === snapshot.configurationDigest
    )));
    assert.equal(cleared, 1);
    await runtime.stop();
    assert.equal(runtime.snapshot().phase, "stopped");
    assert.equal(runtime.snapshot().activeConsumerCount, 0);
    assert.equal(runtime.snapshot().readyConsumerCount, 0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("事件运行时在 DWS 路径解析失败时收敛为 degraded", async () => {
  const runner = new DwsRunner({
    dwsPath: path.join(os.tmpdir(), "junqi-missing-dws-event-runtime"),
    timeoutMs: 2_000,
    maxOutputBytes: 65_536,
  });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventSubscriptions: [{ eventKeys: ["user_oa_approval_task_created"] }],
  }));
  const failures: unknown[] = [];

  await assert.rejects(runtime.start({
    serviceHealth: {
      clearFailure() {},
      reportFailure(error) { failures.push(error); },
    },
  }));

  const snapshot = runtime.snapshot();
  assert.equal(snapshot.phase, "degraded");
  assert.equal(snapshot.activeConsumerCount, 0);
  assert.equal(snapshot.readyConsumerCount, 0);
  assert.ok(failures.length >= 1);
});

test("事件流拒绝坏行后继续接收下一条有效事件", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-invalid-line-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, [
    schemaPrelude(),
    "process.stdin.resume();",
    "process.stderr.write('[event] ready event_key=user_oa_approval_task_finished bus_pid=8 subscribe_id=sub-c\\n');",
    "setTimeout(() => {",
    "  process.stdout.write('not-json\\n');",
    "  process.stdout.write(JSON.stringify({type:'user_oa_approval_task_finished',event_id:'after-invalid'})+'\\n');",
    "}, 10);",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n"));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventSubscriptions: [{ eventKeys: ["user_oa_approval_task_finished"] }],
  }));
  try {
    await runtime.start({});
    await new Promise((resolve) => setTimeout(resolve, 40));
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.phase, "degraded");
    assert.equal(snapshot.rejectedCount, 1);
    assert.deepEqual(snapshot.events.map((event) => event.eventId), ["after-invalid"]);
    assert.equal(snapshot.activeConsumerCount, 1);
    assert.equal(snapshot.readyConsumerCount, 1);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("事件流拒绝缺失或不属于当前订阅的事件类型", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-type-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, [
    schemaPrelude(),
    "process.stdin.resume();",
    "process.stdout.write(JSON.stringify({event_id:'missing-type'})+'\\n');",
    "process.stderr.write('[event] ready event_key=user_oa_approval_task_created bus_pid=11 subscribe_id=sub-e\\n');",
    "setTimeout(() => {",
    "  process.stdout.write(JSON.stringify({type:'user_todo_task_create',event_id:'wrong-type'})+'\\n');",
    "  process.stdout.write(JSON.stringify({type:' user_oa_approval_task_created ',event_id:'padded-type'})+'\\n');",
    "  process.stdout.write(JSON.stringify({type:'user_oa_approval_task_created',event_id:'accepted'})+'\\n');",
    "}, 10);",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n"));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventSubscriptions: [{ eventKeys: ["user_oa_approval_task_created"] }],
  }));
  const emitted: Record<string, unknown>[] = [];
  try {
    await runtime.start({
      gatewayEvents: {
        emit(_event, payload) { emitted.push(payload); },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.phase, "degraded");
    assert.equal(snapshot.rejectedCount, 3);
    assert.deepEqual(snapshot.events.map((event) => [event.eventType, event.eventId]), [
      ["user_oa_approval_task_created", "accepted"],
    ]);
    assert.deepEqual(emitted.map((item) => ({
      revision: item.revision,
      eventType: item.eventType,
    })), [{ revision: 1, eventType: "user_oa_approval_task_created" }]);
    assert.equal(emitted[0]?.runtimeGeneration, snapshot.runtimeGeneration);
    assert.equal(emitted[0]?.configurationDigest, snapshot.configurationDigest);
    assert.deepEqual(snapshot.lastError, {
      code: "DWS_EVENT_PROTOCOL_INVALID",
      message: "DWS event stream protocol is invalid",
    });
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("多事件订阅只接纳该订阅声明的全部事件类型", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-multi-type-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, [
    schemaPrelude(),
    "process.stdin.resume();",
    "process.stderr.write('[event] ready event_count=2 bus_pid=12\\n');",
    "setTimeout(() => {",
    "  process.stdout.write(JSON.stringify({type:'user_todo_task_create',event_id:'create'})+'\\n');",
    "  process.stdout.write(JSON.stringify({type:'user_todo_task_update',event_id:'update'})+'\\n');",
    "}, 10);",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n"));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventSubscriptions: [{ eventKeys: ["user_todo_task_create", "user_todo_task_update"] }],
  }));
  try {
    await runtime.start({});
    await new Promise((resolve) => setTimeout(resolve, 40));
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.phase, "running");
    assert.equal(snapshot.rejectedCount, 0);
    assert.deepEqual(snapshot.events.map((event) => event.eventType), [
      "user_todo_task_create",
      "user_todo_task_update",
    ]);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Gateway 失效通知失败不把有效业务事件误报为协议坏行", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-broadcast-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, [
    schemaPrelude(),
    "process.stdin.resume();",
    "process.stderr.write('[event] ready event_key=user_todo_task_update bus_pid=10 subscribe_id=sub-d\\n');",
    "setTimeout(() => process.stdout.write(JSON.stringify({type:'user_todo_task_update',event_id:'accepted'})+'\\n'), 10);",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n"));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventSubscriptions: [{ eventKeys: ["user_todo_task_update"] }],
  }));
  try {
    await runtime.start({
      gatewayEvents: {
        emit() { throw new Error("private transport detail"); },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.phase, "degraded");
    assert.equal(snapshot.rejectedCount, 0);
    assert.deepEqual(snapshot.events.map((event) => event.eventId), ["accepted"]);
    assert.deepEqual(snapshot.lastError, {
      code: "DWS_EVENT_PROCESS_FAILED",
      message: "DWS event consumer failed",
    });
    assert.equal(JSON.stringify(snapshot).includes("private transport detail"), false);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("事件消费者意外退出后进入 degraded 且不上报原始 stderr", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-events-exit-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, [
    schemaPrelude(),
    "process.stdin.resume();",
    "process.stderr.write('[event] ready event_key=user_todo_task_create bus_pid=9 subscribe_id=sub-b\\n');",
    "setTimeout(() => { process.stderr.write('private upstream detail\\n'); process.exit(1); }, 20);",
  ].join("\n"));
  await chmod(entry, 0o700);
  const runner = new DwsRunner({ dwsPath: entry, timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const runtime = new DingTalkEventRuntime(runner, normalizeDingTalkEventConfig({
    eventProfile: "corp-a:user-a",
    eventSubscriptions: [{ eventKeys: ["user_todo_task_create"] }],
  }));
  const failures: unknown[] = [];
  try {
    await runtime.start({
      serviceHealth: {
        clearFailure() {},
        reportFailure(error) { failures.push(error); },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.phase, "degraded");
    assert.deepEqual(snapshot.lastError, {
      code: "DWS_EVENT_PROCESS_FAILED",
      message: "DWS event consumer failed",
      details: { exitCode: 1 },
    });
    assert.equal(JSON.stringify(snapshot).includes("private upstream detail"), false);
    assert.ok(failures.length >= 1);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
