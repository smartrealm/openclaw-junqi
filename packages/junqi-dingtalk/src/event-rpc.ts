import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { DingTalkEventRuntime, DingTalkEventSnapshot } from "./event-runtime.js";

export const DINGTALK_EVENT_SNAPSHOT_RPC_METHOD = "junqi.dingtalk.events.snapshot";

const EVENT_SNAPSHOT_LIMIT_MAX = 20;
const EVENT_SNAPSHOT_REQUEST_KEYS = new Set(["afterSequence", "limit"]);

interface DingTalkEventSnapshotRpcParams {
  readonly afterSequence: number;
  readonly limit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidRequest(): Error {
  return new Error("DingTalk event snapshot request is invalid");
}

export function parseDingTalkEventSnapshotRpcParams(
  value: unknown,
): DingTalkEventSnapshotRpcParams {
  if (!isRecord(value) || Object.keys(value).some((key) => !EVENT_SNAPSHOT_REQUEST_KEYS.has(key))) {
    throw invalidRequest();
  }
  const afterSequence = value.afterSequence ?? 0;
  const limit = value.limit ?? 20;
  if (
    !Number.isSafeInteger(afterSequence)
    || Number(afterSequence) < 0
    || !Number.isSafeInteger(limit)
    || Number(limit) < 1
    || Number(limit) > EVENT_SNAPSHOT_LIMIT_MAX
  ) {
    throw invalidRequest();
  }
  return { afterSequence: Number(afterSequence), limit: Number(limit) };
}

export function projectDingTalkEventOperatorSnapshot(snapshot: DingTalkEventSnapshot) {
  return {
    runtimeGeneration: snapshot.runtimeGeneration,
    configurationDigest: snapshot.configurationDigest,
    configured: snapshot.configured,
    phase: snapshot.phase,
    profileRef: snapshot.profileRef,
    subscriptionCount: snapshot.subscriptionCount,
    activeConsumerCount: snapshot.activeConsumerCount,
    readyConsumerCount: snapshot.readyConsumerCount,
    eventKeys: [...new Set(snapshot.eventKeys)],
    contractDigest: snapshot.contractDigest,
    latestSequence: snapshot.latestSequence,
    oldestSequence: snapshot.oldestSequence,
    droppedCount: snapshot.droppedCount,
    rejectedCount: snapshot.rejectedCount,
    lastErrorCode: typeof snapshot.lastError?.code === "string"
      ? snapshot.lastError.code
      : null,
    events: snapshot.events.map((event) => ({
      sequence: event.sequence,
      receivedAt: event.receivedAt,
      eventType: event.eventType,
    })),
  };
}

export function registerDingTalkEventSnapshotRpc(
  api: Pick<OpenClawPluginApi, "registerGatewayMethod">,
  runtime: Pick<DingTalkEventRuntime, "snapshot">,
): void {
  api.registerGatewayMethod(
    DINGTALK_EVENT_SNAPSHOT_RPC_METHOD,
    ({ params, respond }) => {
      let request: DingTalkEventSnapshotRpcParams;
      try {
        request = parseDingTalkEventSnapshotRpcParams(params);
      } catch {
        respond(false, undefined, {
          code: "DINGTALK_EVENT_SNAPSHOT_REQUEST_INVALID",
          message: "DingTalk event snapshot request is invalid",
        });
        return;
      }
      try {
        respond(true, projectDingTalkEventOperatorSnapshot(
          runtime.snapshot(request.afterSequence, request.limit),
        ));
      } catch {
        respond(false, undefined, {
          code: "DINGTALK_EVENT_SNAPSHOT_FAILED",
          message: "DingTalk event snapshot is unavailable",
        });
      }
    },
    { scope: "operator.read", profileAccess: "required" },
  );
}
