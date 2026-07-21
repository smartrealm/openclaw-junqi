import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import {
  appendAssistantMirrorMessageByIdentity,
  readSessionTranscriptEvents,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import { evaluateEffectiveAgentAuthorization } from "./agent-authorization-specification.js";
import {
  AcpAgentDispatcher,
  acpDispatchLabel,
  NativeAgentDispatcher,
} from "./agent-dispatcher.js";
import type { AgentDispatcher } from "./agent-dispatcher.js";
import { CollaborationError } from "./errors.js";
import type {
  JsonValue,
  OpenClawAdapterOptions,
  OpenClawRuntime,
} from "./sdk-types.js";
import type {
  AgentTaskLookupResult,
  AgentTaskStatus,
  AgentExecutionRuntime,
  AgentTaskRuntime,
  CapabilityAgent,
  ManagedFlowObservation,
  ManagedFlowControllerLookup,
  OriginRef,
  RuntimeAdapter,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

interface PersistentAgentTaskView {
  id: string;
  runtime?: string;
  ownerKey?: string;
  childSessionKey?: string;
  runId?: string;
  label?: string;
  status: AgentTaskStatus;
  terminalOutcome?: "succeeded" | "blocked";
  terminalSummary?: string;
  error?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function taskLookupFound(task: PersistentAgentTaskView): Extract<AgentTaskLookupResult, { kind: "FOUND" }> {
  return {
    kind: "FOUND",
    taskId: task.id,
    runId: task.runId!,
    status: task.status,
    ...(task.runtime === "acp" && task.childSessionKey ? { childSessionKey: task.childSessionKey } : {}),
    ...(task.terminalOutcome ? { terminalOutcome: task.terminalOutcome } : {}),
    ...(task.terminalSummary ? { terminalSummary: task.terminalSummary } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
}

function isExactAgentTask(
  task: PersistentAgentTaskView,
  identity: { ownerSessionKey: string; childSessionKey: string; runId: string },
  runtime: "subagent" | "acp",
): boolean {
  return task.runtime === runtime
    && task.ownerKey === identity.ownerSessionKey
    && task.childSessionKey === identity.childSessionKey
    && task.runId === identity.runId;
}

function toJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("value must be JSON serializable");
  return JSON.parse(serialized) as JsonValue;
}

function messageText(message: UnknownRecord): string | undefined {
  if (typeof message.content === "string") {
    const value = message.content.trim();
    return value || undefined;
  }
  if (!Array.isArray(message.content)) return undefined;
  const value = message.content
    .map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return "";
      return part.text;
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return value || undefined;
}

function transcriptMessage(event: unknown): UnknownRecord | null {
  if (!isRecord(event)) return null;
  return isRecord(event.message) ? event.message : event;
}

function transcriptEventId(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (typeof event.id === "string") return event.id;
  if (typeof event.messageId === "string") return event.messageId;
  return isRecord(event.message) && typeof event.message.id === "string"
    ? event.message.id
    : undefined;
}

function ownerMainSessionKey(agentId: string): string {
  return `agent:${agentId}:main`;
}

function agentIdFromOwnerSessionKey(ownerSessionKey: string): string | undefined {
  const match = /^agent:([^:]+):main$/.exec(ownerSessionKey);
  return match?.[1];
}

function runtimeKindForOwnerSession(
  ownerSessionKey: string,
  agents: readonly CapabilityAgent[],
): "subagent" | "acp" {
  const agentId = agentIdFromOwnerSessionKey(ownerSessionKey);
  return agents.find((agent) => agent.id === agentId)?.runtimeType === "acp"
    ? "acp"
    : "subagent";
}

function acpChildAgentId(runtime: OpenClawRuntime, configuredAgentId: string): string {
  const configured = runtime.config.current().agents?.list?.find(
    (agent) => normalizeAgentId(agent.id) === normalizeAgentId(configuredAgentId),
  );
  const target = configured?.runtime?.type === "acp"
    ? configured.runtime.acp?.agent
    : undefined;
  return normalizeAgentId(target) || normalizeAgentId(configuredAgentId);
}

function normalizeAgentId(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function assertChildSessionOwner(childSessionKey: string, ownerAgentId: string): void {
  if (!childSessionKey.startsWith(`agent:${ownerAgentId}:`)) {
    throw new CollaborationError(
      "INVALID_REQUEST",
      "Child session key does not belong to the requested worker agent",
      { childSessionKey, ownerAgentId },
    );
  }
}

function mutableConfig(runtime: OpenClawRuntime): OpenClawConfig {
  return structuredClone(runtime.config.current()) as OpenClawConfig;
}

type BoundManagedFlows = ReturnType<OpenClawRuntime["tasks"]["managedFlows"]["bindSession"]>;
type RuntimeFlowRecord = ReturnType<BoundManagedFlows["list"]>[number];

function managedFlowObservation(flow: RuntimeFlowRecord): ManagedFlowObservation {
  return {
    flowId: flow.flowId,
    revision: flow.revision,
    status: flow.status,
    controllerId: typeof flow.controllerId === "string" ? flow.controllerId : null,
    state: isRecord(flow.stateJson) ? structuredClone(flow.stateJson) : null,
    cancelRequestedAt: typeof flow.cancelRequestedAt === "number" ? flow.cancelRequestedAt : null,
  };
}

function lookupManagedFlowByController(
  flows: BoundManagedFlows,
  controllerId: string,
): ManagedFlowControllerLookup {
  const matches = flows.list().filter(
    (flow) => flow.syncMode === "managed" && flow.controllerId === controllerId,
  );
  if (matches.length === 0) return { kind: "ABSENT" };
  if (matches.length > 1) return { kind: "AMBIGUOUS", matchCount: matches.length };
  return { kind: "FOUND", flow: managedFlowObservation(matches[0]!) };
}

export class OpenClawRuntimeAdapter implements RuntimeAdapter {
  readonly #allowedAgentIds: ReadonlySet<string>;
  readonly #coordinatorAgentId: string | undefined;
  readonly #acpRunIds = new Set<string>();

  constructor(
    private readonly runtime: OpenClawRuntime,
    private readonly options: OpenClawAdapterOptions,
  ) {
    this.#allowedAgentIds = new Set((options.allowedAgentIds ?? [])
      .map((agentId) => agentId.trim() === "*" ? "*" : normalizeAgentId(agentId))
      .filter(Boolean));
    this.#coordinatorAgentId = normalizeAgentId(options.coordinatorAgentId) || undefined;
  }

  private dispatcherFor(agent: CapabilityAgent | undefined): AgentDispatcher {
    return agent?.runtimeType === "acp"
      ? new AcpAgentDispatcher(this.runtime, acpChildAgentId(this.runtime, agent.id))
      : new NativeAgentDispatcher(this.runtime);
  }

  get runtimeVersion(): string {
    return this.runtime.version;
  }

  async readOrigin(origin: OriginRef): Promise<{ found: boolean; role?: string; text?: string }> {
    const events = await readSessionTranscriptEvents({
      agentId: origin.agentId,
      sessionKey: origin.sessionKey,
      sessionId: origin.sessionId,
    });
    const event = events.find((entry) => transcriptEventId(entry) === origin.nativeMessageId);
    if (!event) return { found: false };
    const message = transcriptMessage(event);
    if (!message) return { found: true };
    const role = typeof message.role === "string" ? message.role : undefined;
    const text = messageText(message);
    return {
      found: true,
      ...(role ? { role } : {}),
      ...(text ? { text } : {}),
    };
  }

  listConfiguredAgents(): CapabilityAgent[] {
    const config = this.runtime.config.current();
    const agents = config.agents?.list ?? [];
    const configuredIds = new Set(agents.map((agent) => normalizeAgentId(agent.id)).filter(Boolean));
    const coordinator = agents.find((agent) => normalizeAgentId(agent.id) === this.#coordinatorAgentId);
    const coordinatorAllowlist = coordinator?.subagents?.allowAgents
      ?? config.agents?.defaults?.subagents?.allowAgents;
    const coordinatorAllowsAll = coordinatorAllowlist?.some((agentId) => agentId.trim() === "*") === true;
    const coordinatorAllowedIds = Array.isArray(coordinatorAllowlist)
      ? new Set(coordinatorAllowlist.map((agentId) => normalizeAgentId(agentId)).filter((agentId) => configuredIds.has(agentId)))
      : new Set(this.#coordinatorAgentId ? [this.#coordinatorAgentId] : []);
    const pluginAllowsAll = this.#allowedAgentIds.has("*");
    return agents.map((agent) => ({
      id: normalizeAgentId(agent.id),
      ...(agent.name ? { name: agent.name } : {}),
      ...(agent.description ? { description: agent.description } : {}),
      ...(agent.model !== undefined ? { model: agent.model } : {}),
      runtimeType: agent.runtime?.type === "acp" ? "acp" : "native",
      allowed: (pluginAllowsAll || this.#allowedAgentIds.has(normalizeAgentId(agent.id)))
        && (coordinatorAllowsAll || coordinatorAllowedIds.has(normalizeAgentId(agent.id))),
      coordinator: normalizeAgentId(agent.id) === this.#coordinatorAgentId,
    }));
  }

  createManagedFlow(params: {
    sessionKey: string;
    controllerId: string;
    goal: string;
    state: Record<string, unknown>;
  }): ManagedFlowObservation {
    const flows = this.runtime.tasks.managedFlows.bindSession({ sessionKey: params.sessionKey });
    const existing = lookupManagedFlowByController(flows, params.controllerId);
    if (existing.kind === "FOUND") return existing.flow;
    if (existing.kind === "AMBIGUOUS") {
      throw new CollaborationError(
        "INVALID_RESPONSE",
        "Multiple managed Flows use the same JunQi controller identity",
        { controllerId: params.controllerId, matchCount: existing.matchCount },
      );
    }
    const flow = flows.tryCreateManaged({
      controllerId: params.controllerId,
      goal: params.goal,
      status: "running",
      notifyPolicy: "silent",
      stateJson: toJsonValue(params.state),
    });
    const confirmed = lookupManagedFlowByController(flows, params.controllerId);
    if (confirmed.kind === "AMBIGUOUS") {
      throw new CollaborationError(
        "INVALID_RESPONSE",
        "Managed Flow creation produced an ambiguous controller identity",
        { controllerId: params.controllerId, matchCount: confirmed.matchCount },
      );
    }
    if (confirmed.kind === "FOUND") return confirmed.flow;
    if (flow) {
      throw new CollaborationError(
        "INVALID_RESPONSE",
        "Managed Flow creation returned an object that is absent from the owner registry",
        { controllerId: params.controllerId, flowId: flow.flowId },
      );
    }
    throw new CollaborationError(
      "INVALID_RESPONSE",
      `managed flow ${params.controllerId} could not be created or recovered`,
    );
  }

  findManagedFlowByController(params: {
    sessionKey: string;
    controllerId: string;
  }): ManagedFlowControllerLookup {
    const flows = this.runtime.tasks.managedFlows.bindSession({ sessionKey: params.sessionKey });
    return lookupManagedFlowByController(flows, params.controllerId);
  }

  async updateManagedFlow(params: {
    sessionKey: string;
    flowId: string;
    expectedRevision: number;
    state: Record<string, unknown>;
    terminal?: "finished" | "failed" | "cancelled";
  }): Promise<{ revision: number } | null> {
    const flows = this.runtime.tasks.managedFlows.bindSession({ sessionKey: params.sessionKey });
    const stateJson = toJsonValue(params.state);

    if (params.terminal === "cancelled") {
      let current = flows.list().find((flow) => flow.flowId === params.flowId);
      if (!current) return null;
      if (current.status === "cancelled") return { revision: current.revision };
      if (current.cancelRequestedAt == null) {
        if (current.revision !== params.expectedRevision) return null;
        const requested = flows.requestCancel({
          flowId: params.flowId,
          expectedRevision: params.expectedRevision,
        });
        if (!requested.applied) return null;
        current = requested.flow;
      } else if (
        current.revision !== params.expectedRevision
        && current.revision !== params.expectedRevision + 1
      ) {
        return null;
      }
      const cancelled = await flows.cancel({
        flowId: params.flowId,
        cfg: mutableConfig(this.runtime),
      });
      return cancelled.found
        && cancelled.cancelled
        && cancelled.flow?.status === "cancelled"
        ? { revision: cancelled.flow.revision }
        : null;
    }

    const result = params.terminal === "finished"
      ? flows.finish({
          flowId: params.flowId,
          expectedRevision: params.expectedRevision,
          stateJson,
        })
      : params.terminal === "failed"
        ? flows.fail({
            flowId: params.flowId,
            expectedRevision: params.expectedRevision,
            stateJson,
          })
        : flows.resume({
            flowId: params.flowId,
            expectedRevision: params.expectedRevision,
            status: "running",
            stateJson,
          });
    return result.applied ? { revision: result.flow.revision } : null;
  }

  getManagedFlow(params: {
    sessionKey: string;
    flowId: string;
  }): ReturnType<RuntimeAdapter["getManagedFlow"]> {
    const flow = this.runtime.tasks.managedFlows
      .bindSession({ sessionKey: params.sessionKey })
      .list()
      .find((candidate) => candidate.flowId === params.flowId && candidate.syncMode === "managed");
    if (!flow) return null;
    return managedFlowObservation(flow);
  }

  async runAgent(params: {
    ownerAgentId: string;
    childSessionKey: string;
    message: string;
    idempotencyKey: string;
    executionRuntime?: AgentExecutionRuntime;
  }): Promise<{ runId: string; taskId?: string; childSessionKey?: string }> {
    assertChildSessionOwner(params.childSessionKey, params.ownerAgentId);
    const agents = this.listConfiguredAgents();
    const authorization = evaluateEffectiveAgentAuthorization(
      agents,
      params.ownerAgentId,
      "ALLOWED_AGENT",
    );
    if (authorization.kind === "DENIED") {
      throw new CollaborationError("CAPABILITY_CHANGED", authorization.diagnostic, {
        agentId: params.ownerAgentId,
        reason: authorization.reason,
      });
    }
    const configuredAgent = agents.find((agent) => agent.id === normalizeAgentId(params.ownerAgentId));
    const expectedRuntime = params.executionRuntime ?? configuredAgent?.runtimeType ?? "native";
    if (!configuredAgent || configuredAgent.runtimeType !== expectedRuntime) {
      throw new CollaborationError(
        "CAPABILITY_CHANGED",
        "The configured Agent runtime no longer matches the Attempt runtime captured at approval",
        { agentId: params.ownerAgentId, expectedRuntime, actualRuntime: configuredAgent?.runtimeType ?? null },
      );
    }
    const dispatcher = this.dispatcherFor(configuredAgent);
    const result = await dispatcher.dispatch(params);
    if (dispatcher.runtime === "acp") this.#acpRunIds.add(result.runId);
    const ownerSessionKey = ownerMainSessionKey(params.ownerAgentId);
    const childSessionKey = result.childSessionKey ?? params.childSessionKey;
    const matches = this.runtime.tasks.runs
      .bindSession({ sessionKey: ownerSessionKey })
      .list()
      .filter((candidate) => isExactAgentTask(candidate, {
        ownerSessionKey,
        childSessionKey,
        runId: result.runId,
      }, dispatcher.taskRuntime));
    return {
      ...result,
      ...(matches.length === 1 ? { taskId: matches[0]!.id } : {}),
    };
  }

  async findAgentTask(params: {
    ownerSessionKey: string;
    childSessionKey: string;
    expectedTaskId?: string;
    expectedRunId?: string;
    expectedIdempotencyKey?: string;
    taskRuntime?: AgentTaskRuntime;
  }): Promise<AgentTaskLookupResult> {
    const tasks = this.runtime.tasks.runs.bindSession({ sessionKey: params.ownerSessionKey });
    const allTasks = tasks.list();
    const runtime = params.taskRuntime
      ?? (params.childSessionKey.includes(":acp:")
        ? "acp"
        : typeof this.runtime.config?.current === "function"
          ? runtimeKindForOwnerSession(params.ownerSessionKey, this.listConfiguredAgents())
          : "subagent");
    if (params.expectedTaskId) {
      const task = tasks.get(params.expectedTaskId);
      if (!task) return { kind: "ABSENT" };
      if (
        !isExactAgentTask(task, {
          ownerSessionKey: params.ownerSessionKey,
          childSessionKey: task.childSessionKey ?? params.childSessionKey,
          runId: params.expectedRunId ?? task.runId ?? "",
        }, runtime)
        || task.ownerKey !== params.ownerSessionKey
        || (runtime === "subagent" && task.childSessionKey !== params.childSessionKey)
        || (params.expectedRunId != null && task.runId !== params.expectedRunId)
      ) {
        return { kind: "MISMATCH", reason: "The expected OpenClaw Task no longer matches its recorded owner, child session, or run" };
      }
      if (!task.runId?.trim()) {
        return { kind: "MISMATCH", reason: "The expected OpenClaw Task does not expose its recorded run identity" };
      }
      if (runtime === "acp") this.#acpRunIds.add(task.runId);
      return taskLookupFound(task);
    }
    const childMatches = allTasks.filter((candidate) => (
      candidate.runtime === runtime
      && candidate.ownerKey === params.ownerSessionKey
        && (
          runtime === "acp"
          ? candidate.childSessionKey === params.childSessionKey
            || (params.expectedIdempotencyKey != null
              && candidate.label === acpDispatchLabel(params.expectedIdempotencyKey))
          : candidate.childSessionKey === params.childSessionKey
        )
    ));
    const matches = params.expectedRunId
      ? childMatches.filter((candidate) => candidate.runId === params.expectedRunId)
      : childMatches;
    if (matches.length === 0) return { kind: "ABSENT" };
    if (matches.length !== 1) {
      return {
        kind: "AMBIGUOUS",
        matchCount: matches.length,
        reason: "Multiple OpenClaw Tasks use the same child session key",
      };
    }
    const task = matches[0]!;
    if (!task.id?.trim() || !task.runId?.trim()) {
      return {
        kind: "AMBIGUOUS",
        matchCount: 1,
        reason: "The matching OpenClaw Task does not expose a durable task/run identity",
      };
    }
    if (runtime === "acp") this.#acpRunIds.add(task.runId!);
    return taskLookupFound(task);
  }

  waitForRun(
    runId: string,
    timeoutMs: number,
  ): Promise<{ status: "ok" | "error" | "timeout"; error?: string }> {
    if (this.#acpRunIds.has(runId) && typeof this.runtime.gateway?.request === "function") {
      return this.runtime.gateway.request<unknown>("agent.wait", { runId, timeoutMs }).then((value) => {
        if (!isRecord(value) || (value.status !== "ok" && value.status !== "error" && value.status !== "timeout")) {
          throw new CollaborationError("INVALID_RESPONSE", "OpenClaw ACP wait returned an invalid Gateway response");
        }
        return {
          status: value.status,
          ...(typeof value.error === "string" ? { error: value.error } : {}),
        };
      });
    }
    return this.runtime.subagent.waitForRun({ runId, timeoutMs });
  }

  async getSessionMessages(sessionKey: string, limit: number): Promise<unknown[]> {
    if (sessionKey.includes(":acp:")) {
      const agentId = sessionKey.split(":")[1];
      const entry = this.runtime.agent.session.getSessionEntry({
        ...(agentId ? { agentId } : {}),
        sessionKey,
      });
      if (!agentId || typeof entry?.sessionId !== "string" || !entry.sessionId.trim()) {
        throw new CollaborationError("RUNTIME_NOT_DURABLE", "OpenClaw ACP transcript identity is unavailable", {
          sessionKey,
        });
      }
      const events = await readSessionTranscriptEvents({ agentId, sessionKey, sessionId: entry.sessionId });
      return events.slice(-Math.max(1, limit)).map((event) => transcriptMessage(event) ?? event);
    }
    const result = await this.runtime.subagent.getSessionMessages({ sessionKey, limit });
    return result.messages;
  }

  async cancelRun(params: {
    ownerSessionKey: string;
    childSessionKey: string;
    runId: string;
    taskId?: string;
    taskRuntime?: AgentTaskRuntime;
  }): Promise<{ found: boolean; cancelled: boolean; reason?: string }> {
    const tasks = this.runtime.tasks.runs.bindSession({ sessionKey: params.ownerSessionKey });
    const runtime = params.taskRuntime
      ?? (params.childSessionKey.includes(":acp:")
        ? "acp"
        : runtimeKindForOwnerSession(params.ownerSessionKey, this.listConfiguredAgents()));
    const matches = params.taskId
      ? [tasks.get(params.taskId)].filter((task): task is NonNullable<typeof task> => task != null)
      : tasks.list().filter((task) => isExactAgentTask(task, params, runtime));
    if (matches.length > 1) {
      return { found: false, cancelled: false, reason: "task identity is ambiguous" };
    }
    const task = matches[0];
    if (!task) return { found: false, cancelled: false, reason: "task not found" };
    if (!isExactAgentTask(task, params, runtime)) {
      return { found: false, cancelled: false, reason: "task identity mismatch" };
    }
    const result = await tasks.cancel({ taskId: task.id, cfg: mutableConfig(this.runtime) });
    return {
      found: result.found,
      cancelled: result.cancelled,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }

  async appendTranscript(params: {
    origin: OriginRef;
    text: string;
    idempotencyKey: string;
  }): Promise<{ ok: true; messageId: string } | { ok: false; code?: string; reason: string }> {
    const result = await appendAssistantMirrorMessageByIdentity({
      agentId: params.origin.agentId,
      sessionKey: params.origin.sessionKey,
      sessionId: params.origin.sessionId,
      text: params.text,
      idempotencyKey: params.idempotencyKey,
      deliveryMirror: {
        kind: "channel-final",
        sourceMessageId: params.origin.nativeMessageId,
      },
      updateMode: "inline",
      config: mutableConfig(this.runtime),
    });
    if (result.ok) return { ok: true, messageId: result.messageId };
    return {
      ok: false,
      ...(result.code ? { code: result.code } : {}),
      reason: result.reason,
    };
  }

  emitChanged(event: {
    instanceId: string;
    runId: string;
    runRevision: number;
    lastSequence: number;
  }): void {
    const emitted = this.options.emitAgentEvent({
      runId: event.runId,
      stream: "junqi-collab.changed",
      data: {
        collaborationInstanceId: event.instanceId,
        runId: event.runId,
        runRevision: event.runRevision,
        lastSequence: event.lastSequence,
      },
    });
    if (!emitted.emitted) {
      this.options.logger?.warn(`Failed to emit collaboration change event: ${emitted.reason}`);
    }
  }
}
