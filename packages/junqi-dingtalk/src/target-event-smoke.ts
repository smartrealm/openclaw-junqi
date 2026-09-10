import { serializeRuntimeError } from "./errors.js";
import {
  DINGTALK_GATEWAY_EVENT_NAME,
  type DingTalkEventRuntimeConfig,
  type DingTalkEventSnapshot,
  normalizeDingTalkEventConfig,
} from "./event-runtime.js";

export const DINGTALK_TARGET_EVENT_SMOKE_ACKNOWLEDGEMENT = "event-consume-and-wait";

const TARGET_EVENT_REQUIRED_FLAGS = [
  "--dws-path",
  "--profile",
  "--event-key",
  "--wait-seconds",
  "--acknowledge-subscription",
] as const;
const TARGET_EVENT_OPTIONAL_FLAGS = [
  "--user",
  "--open-dingtalk-id",
  "--group",
  "--role-types",
] as const;
const TARGET_EVENT_ALLOWED_FLAGS = new Set<string>([
  ...TARGET_EVENT_REQUIRED_FLAGS,
  ...TARGET_EVENT_OPTIONAL_FLAGS,
]);

export interface DingTalkTargetEventSmokeCliInput {
  readonly dwsPath: string;
  readonly profile: string;
  readonly eventKey: string;
  readonly waitSeconds: number;
  readonly user?: string;
  readonly openDingTalkId?: string;
  readonly group?: string;
  readonly roleTypes?: readonly string[];
}

interface TargetEventRuntime {
  start(context: {
    readonly gatewayEvents: {
      emit(
        event: string,
        payload: Record<string, string | number | boolean | null>,
        options: { scope: "operator.read" },
      ): void;
    };
  }): Promise<void>;
  stop(): Promise<void>;
  snapshot(afterSequence?: number, limit?: number): DingTalkEventSnapshot;
}

interface EventNotice {
  readonly revision: number;
  readonly eventType: string;
}

export interface DingTalkTargetEventSmokeResult {
  readonly status:
    | "verified"
    | "ready_no_event"
    | "failed_before_ready"
    | "invalid_notice"
    | "stop_unverified";
  readonly checkedContractCount: number;
  readonly readyConsumerCount: number;
  readonly receivedEventCount: number;
  readonly notificationCount: number;
  readonly latestSequence: number;
  readonly eventType?: string;
  readonly contractDigest?: string;
  readonly rejectedCount: number;
  readonly droppedCount: number;
  readonly error?: Record<string, unknown>;
  readonly recovery:
    | "none"
    | "fix_runtime_or_permissions_before_retry"
    | "trigger_event_and_retry"
    | "inspect_event_protocol_before_retry"
    | "inspect_subscription_before_retry";
}

function requiredValue(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value || !value.trim()) {
    throw new TypeError("Target event smoke required argument is empty");
  }
  return value.trim();
}

export function parseDingTalkTargetEventSmokeArguments(
  argv: readonly string[],
): DingTalkTargetEventSmokeCliInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !TARGET_EVENT_ALLOWED_FLAGS.has(flag)) {
      throw new TypeError("Target event smoke contains an unsupported argument");
    }
    if (!value) {
      throw new TypeError("Target event smoke argument value is missing");
    }
    if (values.has(flag)) {
      throw new TypeError("Target event smoke contains a duplicate argument");
    }
    values.set(flag, value);
  }
  for (const flag of TARGET_EVENT_REQUIRED_FLAGS) {
    if (!values.has(flag)) {
      throw new TypeError("Target event smoke required argument is missing");
    }
  }
  if (
    values.get("--acknowledge-subscription")
    !== DINGTALK_TARGET_EVENT_SMOKE_ACKNOWLEDGEMENT
  ) {
    throw new TypeError("Target event smoke acknowledgement is invalid");
  }
  const waitSecondsText = requiredValue(values, "--wait-seconds");
  if (!/^[1-9]\d*$/u.test(waitSecondsText)) {
    throw new TypeError("Target event smoke wait seconds must be an integer");
  }
  const waitSeconds = Number(waitSecondsText);
  if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 5 || waitSeconds > 300) {
    throw new TypeError("Target event smoke wait seconds must be between 5 and 300");
  }
  const roleTypesText = values.get("--role-types")?.trim();
  const roleTypes = roleTypesText
    ? roleTypesText.split(",").map((value) => value.trim())
    : undefined;
  if (roleTypes?.some((value) => !value)) {
    throw new TypeError("Target event smoke role types must be non-empty");
  }
  return {
    dwsPath: requiredValue(values, "--dws-path"),
    profile: requiredValue(values, "--profile"),
    eventKey: requiredValue(values, "--event-key"),
    waitSeconds,
    ...(values.get("--user") ? { user: requiredValue(values, "--user") } : {}),
    ...(values.get("--open-dingtalk-id")
      ? { openDingTalkId: requiredValue(values, "--open-dingtalk-id") }
      : {}),
    ...(values.get("--group") ? { group: requiredValue(values, "--group") } : {}),
    ...(roleTypes ? { roleTypes } : {}),
  };
}

export function buildDingTalkTargetEventConfig(
  input: DingTalkTargetEventSmokeCliInput,
): DingTalkEventRuntimeConfig {
  return normalizeDingTalkEventConfig({
    eventProfile: input.profile,
    eventBufferSize: 20,
    eventSubscriptions: [{
      eventKeys: [input.eventKey],
      ...(input.user ? { user: input.user } : {}),
      ...(input.openDingTalkId ? { openDingTalkId: input.openDingTalkId } : {}),
      ...(input.group ? { group: input.group } : {}),
      ...(input.roleTypes ? { roleTypes: input.roleTypes } : {}),
    }],
  });
}

function safeSnapshot(runtime: TargetEventRuntime): DingTalkEventSnapshot | null {
  try {
    return runtime.snapshot(0, 50);
  } catch {
    return null;
  }
}

function resultFields(snapshot: DingTalkEventSnapshot | null, notificationCount: number) {
  return {
    checkedContractCount: snapshot?.contractDigest ? 1 : 0,
    readyConsumerCount: snapshot?.readyConsumerCount ?? 0,
    receivedEventCount: snapshot?.events.length ?? 0,
    notificationCount,
    latestSequence: snapshot?.latestSequence ?? 0,
    ...(snapshot?.contractDigest ? { contractDigest: snapshot.contractDigest } : {}),
    rejectedCount: snapshot?.rejectedCount ?? 0,
    droppedCount: snapshot?.droppedCount ?? 0,
  };
}

export async function runDingTalkTargetEventSmoke(
  runtime: TargetEventRuntime,
  waitMs: number,
): Promise<DingTalkTargetEventSmokeResult> {
  const noticeState: { first: EventNotice | null } = { first: null };
  let invalidNotice = false;
  let notificationCount = 0;
  let resolveNotice!: () => void;
  const noticeReceived = new Promise<void>((resolve) => { resolveNotice = resolve; });
  let startError: unknown;

  try {
    await runtime.start({
      gatewayEvents: {
        emit(event, payload, options) {
          notificationCount += 1;
          const revision = payload.revision;
          const eventType = payload.eventType;
          if (
            event !== DINGTALK_GATEWAY_EVENT_NAME
            || options.scope !== "operator.read"
            || !Number.isSafeInteger(revision)
            || Number(revision) < 1
            || typeof eventType !== "string"
            || !eventType.trim()
          ) {
            invalidNotice = true;
            resolveNotice();
            return;
          }
          noticeState.first ??= { revision: Number(revision), eventType: eventType.trim() };
          resolveNotice();
        },
      },
    });
  } catch (error) {
    startError = error;
  }

  if (!startError) {
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        noticeReceived,
        new Promise<void>((resolve) => {
          waitTimer = setTimeout(resolve, waitMs);
        }),
      ]);
    } finally {
      if (waitTimer) clearTimeout(waitTimer);
    }
  }

  const snapshot = safeSnapshot(runtime);
  let stopError: unknown;
  try {
    await runtime.stop();
  } catch (error) {
    stopError = error;
  }
  const postStopSnapshot = safeSnapshot(runtime);

  const common = resultFields(snapshot, notificationCount);
  const firstNotice = noticeState.first;
  if (stopError || postStopSnapshot?.phase !== "stopped") {
    return {
      status: "stop_unverified",
      ...common,
      ...(firstNotice ? { eventType: firstNotice.eventType } : {}),
      ...(stopError ? { error: serializeRuntimeError(stopError) } : {}),
      recovery: "inspect_subscription_before_retry",
    };
  }
  if (startError) {
    return {
      status: "failed_before_ready",
      ...common,
      error: serializeRuntimeError(startError),
      recovery: "fix_runtime_or_permissions_before_retry",
    };
  }
  if (!firstNotice) {
    const readyWithoutEvent = !invalidNotice
      && snapshot?.phase === "running"
      && snapshot.readyConsumerCount === 1
      && snapshot.rejectedCount === 0
      && snapshot.droppedCount === 0
      && snapshot.events.length === 0;
    return {
      status: readyWithoutEvent ? "ready_no_event" : "invalid_notice",
      ...common,
      recovery: readyWithoutEvent
        ? "trigger_event_and_retry"
        : "inspect_event_protocol_before_retry",
    };
  }
  const matchingEvent = snapshot?.events.find((event) => (
    event.sequence === firstNotice?.revision && event.eventType === firstNotice?.eventType
  ));
  const verified = !invalidNotice
    && snapshot?.phase === "running"
    && snapshot.readyConsumerCount === 1
    && snapshot.rejectedCount === 0
    && snapshot.droppedCount === 0
    && Boolean(matchingEvent);
  return {
    status: verified ? "verified" : "invalid_notice",
    ...common,
    eventType: firstNotice.eventType,
    recovery: verified ? "none" : "inspect_event_protocol_before_retry",
  };
}
