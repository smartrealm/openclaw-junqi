import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { buildDwsEnvironment, type DwsRunner } from "./dws-runner.js";
import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";
import { validateLeafContract } from "./schema-contract.js";
import type { DingTalkToolSpec } from "./types.js";

export const DINGTALK_EVENT_KEYS = [
  "user_im_message_receive_at",
  "user_im_message_receive_o2o",
  "user_im_message_receive_group",
  "user_im_message_receive_user",
  "user_im_message_receive_o2o_all",
  "user_im_message_receive_group_all",
  "user_im_message_read_o2o",
  "user_im_message_read_group",
  "user_im_message_recall_o2o",
  "user_im_message_recall_group",
  "user_im_message_reaction_o2o",
  "user_im_message_reaction_group",
  "user_im_group_updated",
  "user_im_group_member_added",
  "user_im_group_member_exited",
  "user_im_group_disbanded",
  "user_oa_approval_task_created",
  "user_oa_approval_task_finished",
  "user_oa_approval_task_redirected",
  "user_oa_approval_instance_started",
  "user_oa_approval_instance_cc",
  "user_oa_approval_instance_terminated",
  "user_oa_approval_instance_finished",
  "user_voip_call_receive_invite",
  "user_todo_task_create",
  "user_todo_task_update",
  "user_todo_task_delete",
] as const;
export const DINGTALK_GATEWAY_EVENT_NAME = "events_changed";

export type DingTalkEventKey = typeof DINGTALK_EVENT_KEYS[number];
type DingTalkEventCategory = "im-none" | "im-user" | "im-group" | "oa" | "voip" | "todo";

const EVENT_KEY_SET = new Set<string>(DINGTALK_EVENT_KEYS);
const IM_NONE_KEYS = new Set<DingTalkEventKey>([
  "user_im_message_receive_at",
  "user_im_message_receive_o2o_all",
  "user_im_message_receive_group_all",
]);
const IM_USER_KEYS = new Set<DingTalkEventKey>([
  "user_im_message_receive_o2o",
  "user_im_message_receive_user",
  "user_im_message_read_o2o",
  "user_im_message_recall_o2o",
  "user_im_message_reaction_o2o",
]);
const IM_GROUP_KEYS = new Set<DingTalkEventKey>([
  "user_im_message_receive_group",
  "user_im_message_read_group",
  "user_im_message_recall_group",
  "user_im_message_reaction_group",
  "user_im_group_updated",
  "user_im_group_member_added",
  "user_im_group_member_exited",
  "user_im_group_disbanded",
]);
const TODO_ROLE_TYPES = ["creator", "executor", "participant"] as const;
const EVENT_READY_SINGLE = /^\[event\] ready event_key=(\S+) bus_pid=\d+ subscribe_id=\S+$/;
const EVENT_READY_MULTI = /^\[event\] ready event_count=(\d+) bus_pid=\d+$/;
const MAX_EVENT_LINE_BYTES = 131_072;
const EVENT_STOP_GRACE_MS = 5_000;
const EVENT_TERMINATE_GRACE_MS = 2_000;
const EVENT_CONSUME_SPEC = {
  name: "junqi_dingtalk_event_consume_runtime",
  label: "钉钉事件消费运行时",
  description: "由 OpenClaw 服务生命周期托管钉钉个人事件消费进程",
  domain: "chat",
  canonicalPath: "event.consume",
  cliPath: "event consume",
  effect: "write",
  risk: "medium",
  confirmation: "not_required",
  idempotency: "non_idempotent",
} as const satisfies DingTalkToolSpec;
const EVENT_REQUIRED_PARAMETERS = [
  "flatten",
  "format",
  "user",
  "open-dingtalk-id",
  "group",
  "role-types",
] as const;

export interface DingTalkEventSubscriptionConfig {
  readonly eventKeys: readonly DingTalkEventKey[];
  readonly user?: string;
  readonly openDingTalkId?: string;
  readonly group?: string;
  readonly roleTypes?: readonly (typeof TODO_ROLE_TYPES[number])[];
}

export interface DingTalkEventRuntimeConfig {
  readonly profile?: string;
  readonly subscriptions: readonly DingTalkEventSubscriptionConfig[];
  readonly bufferSize: number;
}

export interface DingTalkEventRecord {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly profileRef: string;
  readonly eventType: string;
  readonly eventId: string | null;
  readonly payload: Record<string, unknown>;
}

export interface DingTalkEventSnapshot {
  readonly runtimeGeneration: string;
  readonly configurationDigest: string;
  readonly configured: boolean;
  readonly phase: "disabled" | "starting" | "running" | "degraded" | "stopping" | "stopped";
  readonly profileRef: string | null;
  readonly subscriptionCount: number;
  readonly activeConsumerCount: number;
  readonly readyConsumerCount: number;
  readonly eventKeys: readonly string[];
  readonly contractDigest: string | null;
  readonly latestSequence: number;
  readonly oldestSequence: number | null;
  readonly droppedCount: number;
  readonly rejectedCount: number;
  readonly lastError: Record<string, unknown> | null;
  readonly events: readonly DingTalkEventRecord[];
}

export function canonicalDingTalkEventConfiguration(
  config: DingTalkEventRuntimeConfig,
): string {
  return JSON.stringify([
    config.profile ?? null,
    config.bufferSize,
    config.subscriptions.map((subscription) => [
      subscription.eventKeys,
      subscription.user ?? null,
      subscription.openDingTalkId ?? null,
      subscription.group ?? null,
      subscription.roleTypes ?? null,
    ]),
  ]);
}

export function digestDingTalkEventConfiguration(
  config: DingTalkEventRuntimeConfig,
): string {
  return createHash("sha256")
    .update(canonicalDingTalkEventConfiguration(config))
    .digest("hex");
}

interface DingTalkEventServiceContext {
  readonly serviceHealth?: {
    reportFailure(error: unknown): void;
    clearFailure(): void;
  };
  readonly gatewayEvents?: {
    emit(
      event: string,
      payload: Record<string, string | number | boolean | null>,
      options: { scope: "operator.read" },
    ): void;
  };
}

interface EventConsumer {
  readonly index: number;
  readonly config: DingTalkEventSubscriptionConfig;
  readonly child: ChildProcessWithoutNullStreams;
  readonly closePromise: Promise<void>;
  ready: boolean;
  failed: boolean;
  stdout: Buffer;
  stderr: Buffer;
  pendingPayloads: Record<string, unknown>[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function eventConfigurationError(message: string): DingTalkRuntimeError {
  return new DingTalkRuntimeError("DWS_EVENT_CONFIGURATION_INVALID", message);
}

function categoryForKey(key: DingTalkEventKey): DingTalkEventCategory {
  if (IM_NONE_KEYS.has(key)) return "im-none";
  if (IM_USER_KEYS.has(key)) return "im-user";
  if (IM_GROUP_KEYS.has(key)) return "im-group";
  if (key.startsWith("user_oa_")) return "oa";
  if (key.startsWith("user_todo_")) return "todo";
  return "voip";
}

function normalizedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw eventConfigurationError("DingTalk event keys must be an array");
  return value.map((item) => {
    const normalized = nonEmptyString(item);
    if (!normalized) throw eventConfigurationError("DingTalk event keys must be non-empty strings");
    return normalized;
  });
}

function normalizeSubscription(value: unknown): DingTalkEventSubscriptionConfig {
  const source = record(value);
  if (!source) throw eventConfigurationError("DingTalk event subscription must be an object");
  const unknownFields = Object.keys(source).filter((key) => ![
    "eventKeys",
    "user",
    "openDingTalkId",
    "group",
    "roleTypes",
  ].includes(key));
  if (unknownFields.length > 0) {
    throw eventConfigurationError("DingTalk event subscription contains unsupported fields");
  }
  const rawKeys = normalizedStringArray(source.eventKeys);
  if (rawKeys.length === 0 || rawKeys.length > DINGTALK_EVENT_KEYS.length) {
    throw eventConfigurationError("DingTalk event subscription must contain between 1 and 27 event keys");
  }
  if (new Set(rawKeys).size !== rawKeys.length || rawKeys.some((key) => !EVENT_KEY_SET.has(key))) {
    throw eventConfigurationError("DingTalk event subscription contains duplicate or unsupported event keys");
  }
  const eventKeys = rawKeys as DingTalkEventKey[];
  const categories = new Set(eventKeys.map(categoryForKey));
  if (categories.size !== 1) {
    throw eventConfigurationError("One DingTalk event subscription cannot mix event categories");
  }
  const category = categories.values().next().value as DingTalkEventCategory;
  const user = nonEmptyString(source.user);
  const openDingTalkId = nonEmptyString(source.openDingTalkId);
  const group = nonEmptyString(source.group);
  if ((source.user !== undefined && !user)
    || (source.openDingTalkId !== undefined && !openDingTalkId)
    || (source.group !== undefined && !group)) {
    throw eventConfigurationError("DingTalk event target fields must be non-empty strings");
  }
  const roleTypes = source.roleTypes === undefined
    ? undefined
    : normalizedStringArray(source.roleTypes);

  if (category === "im-user") {
    if (Boolean(user) === Boolean(openDingTalkId) || group || roleTypes) {
      throw eventConfigurationError("User-scoped IM events require exactly one user identity field");
    }
  } else if (category === "im-group") {
    if (!group || user || openDingTalkId || roleTypes) {
      throw eventConfigurationError("Group-scoped IM events require one group and no other target");
    }
  } else if (category === "todo") {
    if (user || openDingTalkId || group) {
      throw eventConfigurationError("Todo events do not accept IM target fields");
    }
    if (roleTypes && (
      roleTypes.length === 0
      || new Set(roleTypes).size !== roleTypes.length
      || roleTypes.some((role) => !TODO_ROLE_TYPES.includes(role as typeof TODO_ROLE_TYPES[number]))
    )) {
      throw eventConfigurationError("Todo event roleTypes contains duplicate or unsupported roles");
    }
  } else if (user || openDingTalkId || group || roleTypes) {
    throw eventConfigurationError("Untargeted DingTalk events do not accept target or role fields");
  }

  return {
    eventKeys,
    ...(user ? { user } : {}),
    ...(openDingTalkId ? { openDingTalkId } : {}),
    ...(group ? { group } : {}),
    ...(roleTypes ? { roleTypes: roleTypes as (typeof TODO_ROLE_TYPES[number])[] } : {}),
  };
}

export function normalizeDingTalkEventConfig(
  input: Record<string, unknown> | undefined,
): DingTalkEventRuntimeConfig {
  const source = input ?? {};
  const profile = nonEmptyString(source.eventProfile);
  if (source.eventProfile !== undefined && !profile) {
    throw eventConfigurationError("DingTalk event profile must be a non-empty string");
  }
  if (profile && !/^[^:\s]+:[^:\s]+$/.test(profile)) {
    throw eventConfigurationError("DingTalk event profile must use the exact <corpId>:<userId> form");
  }
  const subscriptions = source.eventSubscriptions === undefined
    ? []
    : Array.isArray(source.eventSubscriptions)
      ? source.eventSubscriptions.map(normalizeSubscription)
      : (() => { throw eventConfigurationError("DingTalk event subscriptions must be an array"); })();
  if (subscriptions.length > 0 && !profile) {
    throw eventConfigurationError("DingTalk event subscriptions require an exact eventProfile");
  }
  if (subscriptions.length > 8) {
    throw eventConfigurationError("DingTalk event runtime supports at most 8 subscriptions");
  }
  const fingerprints = subscriptions.map((subscription) => JSON.stringify(subscription));
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw eventConfigurationError("DingTalk event subscriptions must be unique");
  }
  const configuredBufferSize = source.eventBufferSize;
  if (configuredBufferSize !== undefined && (
    typeof configuredBufferSize !== "number"
    || !Number.isInteger(configuredBufferSize)
    || configuredBufferSize < 1
    || configuredBufferSize > 200
  )) {
    throw eventConfigurationError("DingTalk event buffer size must be an integer between 1 and 200");
  }
  const bufferSize = typeof configuredBufferSize === "number"
    && Number.isInteger(configuredBufferSize)
    && configuredBufferSize >= 1
    && configuredBufferSize <= 200
    ? configuredBufferSize
    : 100;
  return { ...(profile ? { profile } : {}), subscriptions, bufferSize };
}

export function buildDwsEventArguments(
  profile: string,
  subscription: DingTalkEventSubscriptionConfig,
): string[] {
  return [
    "--profile",
    profile,
    "event",
    "consume",
    ...subscription.eventKeys,
    ...(subscription.user ? ["--user", subscription.user] : []),
    ...(subscription.openDingTalkId ? ["--open-dingtalk-id", subscription.openDingTalkId] : []),
    ...(subscription.group ? ["--group", subscription.group] : []),
    ...(subscription.roleTypes ? ["--role-types", subscription.roleTypes.join(",")] : []),
    "--flatten",
    "--format",
    "ndjson",
  ];
}

export async function verifyDwsEventConsumeContract(runner: DwsRunner): Promise<string> {
  const result = await runner.run(["schema", EVENT_CONSUME_SPEC.canonicalPath]);
  const verified = validateLeafContract(EVENT_CONSUME_SPEC, result.data);
  const missing = EVENT_REQUIRED_PARAMETERS.filter((name) => !verified.schema.parameters?.[name]);
  if (missing.length > 0) {
    throw new DingTalkRuntimeError(
      "DWS_SCHEMA_DRIFT",
      "DWS event consume schema is missing required parameters",
      { fields: missing },
    );
  }
  return verified.digest;
}

function appendBoundedLines(
  pending: Buffer,
  chunk: Buffer,
  onLine: (line: string) => void,
): Buffer {
  let buffer = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
  let lineEnd = buffer.indexOf(0x0a);
  while (lineEnd >= 0) {
    let line = buffer.subarray(0, lineEnd);
    buffer = buffer.subarray(lineEnd + 1);
    if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
    if (line.length > MAX_EVENT_LINE_BYTES) {
      throw new DingTalkRuntimeError("DWS_EVENT_PROTOCOL_INVALID", "DWS event line exceeded the limit");
    }
    onLine(line.toString("utf8"));
    lineEnd = buffer.indexOf(0x0a);
  }
  if (buffer.length > MAX_EVENT_LINE_BYTES) {
    throw new DingTalkRuntimeError("DWS_EVENT_PROTOCOL_INVALID", "DWS event line exceeded the limit");
  }
  return Buffer.from(buffer);
}

function eventIdentity(payload: Record<string, unknown>, eventType: string): string | null {
  const preferred = eventType === "user_voip_call_receive_invite"
    ? nonEmptyString(payload.biz_id) ?? nonEmptyString(payload.event_id)
    : nonEmptyString(payload.event_id);
  return preferred ? `${eventType}:${preferred}` : null;
}

export class DingTalkEventRuntime {
  private readonly runtimeGeneration = randomUUID();
  private readonly configurationDigest: string;
  private phase: DingTalkEventSnapshot["phase"] = "disabled";
  private context: DingTalkEventServiceContext | null = null;
  private consumers: EventConsumer[] = [];
  private events: DingTalkEventRecord[] = [];
  private dedupeOrder: string[] = [];
  private dedupe = new Set<string>();
  private sequence = 0;
  private contractDigest: string | null = null;
  private droppedCount = 0;
  private rejectedCount = 0;
  private lastError: Record<string, unknown> | null = null;
  private stopping = false;

  constructor(
    private readonly runner: DwsRunner,
    private readonly config: DingTalkEventRuntimeConfig,
  ) {
    this.configurationDigest = digestDingTalkEventConfiguration(config);
  }

  async start(context: DingTalkEventServiceContext): Promise<void> {
    if (this.config.subscriptions.length === 0 || !this.config.profile) {
      this.phase = "disabled";
      return;
    }
    if (this.consumers.length > 0) {
      throw new DingTalkRuntimeError("DWS_EVENT_PROCESS_FAILED", "DWS event runtime is already started");
    }
    this.phase = "starting";
    this.context = context;
    this.stopping = false;
    this.lastError = null;
    try {
      const executable = await this.runner.resolveExecutable();
      this.contractDigest = await verifyDwsEventConsumeContract(this.runner);
      await Promise.all(this.config.subscriptions.map((subscription, index) => (
        this.startConsumer(executable, subscription, index)
      )));
      if (this.consumers.some((consumer) => consumer.failed || !consumer.ready)) {
        throw new DingTalkRuntimeError("DWS_EVENT_PROCESS_FAILED", "DWS event consumer exited during startup");
      }
      if (this.lastError) {
        this.phase = "degraded";
      } else {
        this.phase = "running";
        context.serviceHealth?.clearFailure();
      }
    } catch (error) {
      this.recordFailure(error);
      this.stopping = true;
      try {
        await this.stopConsumers();
      } catch (cleanupError) {
        this.recordFailure(cleanupError);
      } finally {
        this.stopping = false;
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.consumers.length === 0) {
      this.phase = this.config.subscriptions.length === 0 ? "disabled" : "stopped";
      this.context = null;
      return;
    }
    this.stopping = true;
    this.phase = "stopping";
    try {
      await this.stopConsumers();
      this.phase = "stopped";
    } catch (error) {
      this.recordFailure(error);
      throw error;
    } finally {
      this.stopping = false;
      this.context = null;
    }
  }

  snapshot(afterSequence = 0, limit = 20): DingTalkEventSnapshot {
    const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 20;
    const events = this.events.filter((event) => event.sequence > afterSequence).slice(-boundedLimit);
    return {
      runtimeGeneration: this.runtimeGeneration,
      configurationDigest: this.configurationDigest,
      configured: this.config.subscriptions.length > 0 && Boolean(this.config.profile),
      phase: this.phase,
      profileRef: this.config.profile ?? null,
      subscriptionCount: this.config.subscriptions.length,
      activeConsumerCount: this.consumers.filter((consumer) => consumer.child.exitCode === null).length,
      readyConsumerCount: this.consumers.filter((consumer) => (
        consumer.ready && consumer.child.exitCode === null
      )).length,
      eventKeys: this.config.subscriptions.flatMap((subscription) => subscription.eventKeys),
      contractDigest: this.contractDigest,
      latestSequence: this.sequence,
      oldestSequence: this.events[0]?.sequence ?? null,
      droppedCount: this.droppedCount,
      rejectedCount: this.rejectedCount,
      lastError: this.lastError,
      events,
    };
  }

  private async startConsumer(
    executable: string,
    subscription: DingTalkEventSubscriptionConfig,
    index: number,
  ): Promise<void> {
    const args = buildDwsEventArguments(this.config.profile!, subscription);
    const nodeScript = path.extname(executable).toLowerCase() === ".js";
    const child = spawn(nodeScript ? process.execPath : executable, nodeScript ? [executable, ...args] : args, {
      env: buildDwsEnvironment(process.env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {});
    let resolveClose!: () => void;
    const closePromise = new Promise<void>((resolve) => { resolveClose = resolve; });
    const consumer: EventConsumer = {
      index,
      config: subscription,
      child,
      closePromise,
      ready: false,
      failed: false,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      pendingPayloads: [],
    };
    this.consumers.push(consumer);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finishReady = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const failReady = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const protocolFailure = (error: unknown): void => {
        this.rejectedCount += 1;
        consumer.failed = true;
        this.recordFailure(error);
        consumer.child.stdin.end();
        failReady(error);
      };
      child.stdout.on("data", (chunk: Buffer) => {
        try {
          consumer.stdout = appendBoundedLines(consumer.stdout, chunk, (line) => {
            if (!line.trim()) return;
            try {
              const payload = record(JSON.parse(line) as unknown);
              if (!payload) throw new Error("event payload is not an object");
              if (consumer.ready) {
                this.acceptEvent(payload, subscription);
              } else if (consumer.pendingPayloads.length < this.config.bufferSize) {
                consumer.pendingPayloads.push(payload);
              } else {
                consumer.pendingPayloads.shift();
                consumer.pendingPayloads.push(payload);
                this.droppedCount += 1;
              }
            } catch {
              this.rejectedCount += 1;
              this.recordFailure(new DingTalkRuntimeError(
                "DWS_EVENT_PROTOCOL_INVALID",
                "DWS event output was not a JSON object",
              ));
            }
          });
        } catch (error) {
          protocolFailure(error);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        try {
          consumer.stderr = appendBoundedLines(consumer.stderr, chunk, (line) => {
            const single = line.match(EVENT_READY_SINGLE);
            const multiple = line.match(EVENT_READY_MULTI);
            const readyMatches = subscription.eventKeys.length === 1
              ? single?.[1] === subscription.eventKeys[0]
              : Number(multiple?.[1]) === subscription.eventKeys.length;
            if (!readyMatches) return;
            consumer.ready = true;
            for (const payload of consumer.pendingPayloads) this.acceptEvent(payload, subscription);
            consumer.pendingPayloads = [];
            finishReady();
          });
        } catch (error) {
          protocolFailure(error);
        }
      });
      child.once("error", () => {
        consumer.failed = true;
        const error = new DingTalkRuntimeError("DWS_EVENT_PROCESS_FAILED", "Failed to start DWS event consumer");
        this.recordFailure(error);
        failReady(error);
        resolveClose();
      });
      child.once("close", (code) => {
        consumer.failed = !this.stopping;
        resolveClose();
        if (!this.stopping) {
          const error = new DingTalkRuntimeError(
            "DWS_EVENT_PROCESS_FAILED",
            "DWS event consumer exited unexpectedly",
            { exitCode: code },
          );
          this.recordFailure(error);
          failReady(error);
        }
      });
      const timer = setTimeout(() => {
        const error = new DingTalkRuntimeError(
          "DWS_EVENT_STARTUP_TIMEOUT",
          "DWS event consumer did not reach the ready marker",
        );
        consumer.failed = true;
        this.recordFailure(error);
        consumer.child.stdin.end();
        failReady(error);
      }, this.runner.config.timeoutMs);
      timer.unref();
    });
  }

  private acceptEvent(
    payload: Record<string, unknown>,
    subscription: DingTalkEventSubscriptionConfig,
  ): void {
    const eventType = nonEmptyString(payload.type);
    if (
      !eventType
      || payload.type !== eventType
      || !subscription.eventKeys.some((key) => key === eventType)
    ) {
      this.rejectedCount += 1;
      this.recordFailure(new DingTalkRuntimeError(
        "DWS_EVENT_PROTOCOL_INVALID",
        "DWS event type did not match the requested subscription",
      ));
      return;
    }
    const identity = eventIdentity(payload, eventType);
    if (identity && this.dedupe.has(identity)) return;
    if (identity) {
      this.dedupe.add(identity);
      this.dedupeOrder.push(identity);
      while (this.dedupeOrder.length > this.config.bufferSize * 2) {
        const expired = this.dedupeOrder.shift();
        if (expired) this.dedupe.delete(expired);
      }
    }
    this.sequence += 1;
    const eventId = nonEmptyString(payload.event_id) ?? null;
    this.events.push({
      sequence: this.sequence,
      receivedAt: new Date().toISOString(),
      profileRef: this.config.profile!,
      eventType,
      eventId,
      payload,
    });
    while (this.events.length > this.config.bufferSize) {
      this.events.shift();
      this.droppedCount += 1;
    }
    try {
      this.context?.gatewayEvents?.emit(
        DINGTALK_GATEWAY_EVENT_NAME,
        {
          revision: this.sequence,
          eventType,
          runtimeGeneration: this.runtimeGeneration,
          configurationDigest: this.configurationDigest,
        },
        { scope: "operator.read" },
      );
    } catch {
      this.recordFailure(new DingTalkRuntimeError(
        "DWS_EVENT_PROCESS_FAILED",
        "Failed to publish DingTalk event invalidation",
      ));
    }
  }

  private recordFailure(error: unknown): void {
    this.lastError = serializeRuntimeError(error);
    this.phase = "degraded";
    this.context?.serviceHealth?.reportFailure(error);
  }

  private async stopConsumers(): Promise<void> {
    const consumers = [...this.consumers];
    let stopError: DingTalkRuntimeError | null = null;
    for (const consumer of consumers) consumer.child.stdin.end();
    await Promise.all(consumers.map(async (consumer) => {
      const clean = await Promise.race([
        consumer.closePromise.then(() => true),
        new Promise<false>((resolve) => {
          const timer = setTimeout(() => resolve(false), EVENT_STOP_GRACE_MS);
          timer.unref();
        }),
      ]);
      if (clean) return;
      consumer.child.kill("SIGTERM");
      const terminated = await Promise.race([
        consumer.closePromise.then(() => true),
        new Promise<false>((resolve) => {
          const timer = setTimeout(() => resolve(false), EVENT_TERMINATE_GRACE_MS);
          timer.unref();
        }),
      ]);
      if (!terminated) {
        stopError ??= new DingTalkRuntimeError(
          "DWS_EVENT_STOP_TIMEOUT",
          "DWS event consumer did not exit after graceful shutdown",
        );
      }
    }));
    if (stopError) throw stopError;
    this.consumers = [];
  }
}
