import type { OpenClawRuntime } from "./sdk-types.js";
import { CollaborationError, type CollaborationErrorCode } from "./errors.js";
import { sha256 } from "./util.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface AgentDispatchRequest {
  ownerAgentId: string;
  childSessionKey: string;
  message: string;
  idempotencyKey: string;
}

export interface AgentDispatchResult {
  runId: string;
  childSessionKey?: string;
}

export interface AgentDispatcher {
  readonly runtime: "native" | "acp";
  readonly taskRuntime: "subagent" | "acp";
  dispatch(params: AgentDispatchRequest): Promise<AgentDispatchResult>;
}

/**
 * The runtime rejected the dispatch before creating an external Task.
 * This is deliberately distinct from an unknown transport outcome: callers
 * may safely settle the local Attempt as terminal and must not start recovery.
 */
export class AgentDispatchNotStartedError extends CollaborationError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    code: CollaborationErrorCode = "CAPABILITY_CHANGED",
  ) {
    super(code, message, details);
    this.name = "AgentDispatchNotStartedError";
  }
}

export function acpDispatchLabel(idempotencyKey: string): string {
  return `junqi-collab:${sha256(idempotencyKey).slice(0, 32)}`;
}

function readAcpSpawnResult(value: unknown): { runId: string; childSessionKey: string } {
  if (isRecord(value) && value.ok === false) {
    const diagnostic = isRecord(value.error) && typeof value.error.message === "string"
      ? value.error.message
      : "OpenClaw ACP spawn was rejected by Gateway policy";
    throw new AgentDispatchNotStartedError(diagnostic, { runtime: "acp", rejected: true });
  }
  if (!isRecord(value) || value.ok !== true || !isRecord(value.output)) {
    throw new CollaborationError("INVALID_RESPONSE", "OpenClaw ACP spawn returned an invalid Gateway response");
  }
  const output = value.output;
  if (output.status !== "accepted") {
    const diagnostic = isRecord(output.error) && typeof output.error.message === "string"
      ? output.error.message
      : isRecord(value.error) && typeof value.error.message === "string"
        ? value.error.message
        : "OpenClaw ACP spawn was not accepted";
    throw new CollaborationError("CAPABILITY_CHANGED", diagnostic, {
      runtime: "acp",
      status: output.status,
    });
  }
  if (typeof output.runId !== "string" || !output.runId.trim()) {
    throw new CollaborationError("INVALID_RESPONSE", "OpenClaw ACP spawn did not return a run id");
  }
  if (typeof output.childSessionKey !== "string" || !output.childSessionKey.trim()) {
    throw new CollaborationError("INVALID_RESPONSE", "OpenClaw ACP spawn did not return a child session key");
  }
  return { runId: output.runId, childSessionKey: output.childSessionKey };
}

export class NativeAgentDispatcher implements AgentDispatcher {
  readonly runtime = "native" as const;
  readonly taskRuntime = "subagent" as const;

  constructor(private readonly openclaw: OpenClawRuntime) {}

  async dispatch(params: AgentDispatchRequest): Promise<AgentDispatchResult> {
    const result = await this.openclaw.subagent.run({
      sessionKey: params.childSessionKey,
      message: params.message,
      idempotencyKey: params.idempotencyKey,
      deliver: false,
    });
    return { runId: result.runId };
  }
}

export class AcpAgentDispatcher implements AgentDispatcher {
  readonly runtime = "acp" as const;
  readonly taskRuntime = "acp" as const;

  constructor(
    private readonly openclaw: OpenClawRuntime,
    private readonly childAgentId: string,
  ) {}

  async dispatch(params: AgentDispatchRequest): Promise<AgentDispatchResult> {
    if (typeof this.openclaw.gateway?.request !== "function") {
      throw new AgentDispatchNotStartedError(
        "OpenClaw Gateway RPC is unavailable for ACP Agent execution",
        { agentId: params.ownerAgentId, runtime: "acp", rejected: true },
        "RUNTIME_NOT_DURABLE",
      );
    }
    const gatewayResult = await this.openclaw.gateway.request<unknown>("tools.invoke", {
      name: "sessions_spawn",
      args: {
        task: params.message,
        runtime: "acp",
        agentId: params.ownerAgentId,
        mode: "run",
        label: acpDispatchLabel(params.idempotencyKey),
      },
      sessionKey: `agent:${params.ownerAgentId}:main`,
      agentId: params.ownerAgentId,
      idempotencyKey: params.idempotencyKey,
    });
    const result = readAcpSpawnResult(gatewayResult);
    if (!result.childSessionKey.startsWith(`agent:${this.childAgentId}:acp:`)) {
      throw new CollaborationError(
        "INVALID_RESPONSE",
        "OpenClaw ACP spawn returned a child session owned by another Agent",
        { agentId: params.ownerAgentId, childSessionKey: result.childSessionKey },
      );
    }
    return result;
  }
}
