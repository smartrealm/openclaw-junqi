import type { CapabilityAgent } from "./types.js";

export type AgentDispatchKind = "PLANNER" | "WORKER" | "SYNTHESIZER";
export type AgentAuthorizationRequirement = "ALLOWED_AGENT" | "ALLOWED_COORDINATOR";

export type EffectiveAgentAuthorizationDecision =
  | Readonly<{ kind: "AUTHORIZED"; agent: CapabilityAgent }>
  | Readonly<{
      kind: "DENIED";
      reason: "AGENT_NOT_CONFIGURED" | "AGENT_NOT_ALLOWED" | "COORDINATOR_AUTHORIZATION_CHANGED";
      diagnostic: string;
    }>;

export type AgentDispatchAuthorizationDecision =
  | Readonly<{ kind: "AUTHORIZED"; agent: CapabilityAgent }>
  | Readonly<{
      kind: "DENIED";
      reason:
        | "AGENT_NOT_CONFIGURED"
        | "AGENT_NOT_ALLOWED"
        | "COORDINATOR_AUTHORIZATION_CHANGED"
        | "CAPABILITY_FENCE_MISSING"
        | "CAPABILITY_FENCE_CHANGED";
      diagnostic: string;
    }>;

export interface AgentDispatchAuthorizationContext {
  readonly agentId: string;
  readonly attemptKind: AgentDispatchKind;
  readonly configuredAgents: readonly CapabilityAgent[];
  readonly persistedConfigHash: string | null;
  readonly currentConfigHash: string;
}

/**
 * Pure specification over the effective OpenClaw authorization view. The
 * adapter supplies the intersection of the plugin allowlist and the current
 * coordinator spawn allowlist, so callers cannot accidentally validate only
 * one policy source.
 */
export function evaluateEffectiveAgentAuthorization(
  configuredAgents: readonly CapabilityAgent[],
  agentId: string,
  requirement: AgentAuthorizationRequirement,
): EffectiveAgentAuthorizationDecision {
  const agent = configuredAgents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return {
      kind: "DENIED",
      reason: "AGENT_NOT_CONFIGURED",
      diagnostic: `Agent ${agentId} is no longer present in the effective OpenClaw configuration`,
    };
  }
  if (!agent.allowed) {
    return {
      kind: "DENIED",
      reason: "AGENT_NOT_ALLOWED",
      diagnostic: `Agent ${agentId} authorization was revoked by the plugin or coordinator spawn policy`,
    };
  }
  if (requirement === "ALLOWED_COORDINATOR" && !agent.coordinator) {
    return {
      kind: "DENIED",
      reason: "COORDINATOR_AUTHORIZATION_CHANGED",
      diagnostic: `Agent ${agentId} is no longer the allowed collaboration coordinator`,
    };
  }
  return { kind: "AUTHORIZED", agent };
}

/**
 * Pre-effect authorization fence for durable Agent commands. An Agent must be
 * effectively allowed now and the exact approved capability configuration
 * must still be current. A denial is data, not an exception, so the Service
 * can atomically persist a deterministic intervention without retrying the
 * external effect.
 */
export function decideAgentDispatchAuthorization(
  context: AgentDispatchAuthorizationContext,
): AgentDispatchAuthorizationDecision {
  const effective = evaluateEffectiveAgentAuthorization(
    context.configuredAgents,
    context.agentId,
    context.attemptKind === "WORKER" ? "ALLOWED_AGENT" : "ALLOWED_COORDINATOR",
  );
  if (effective.kind === "DENIED") return effective;
  if (!context.persistedConfigHash) {
    return {
      kind: "DENIED",
      reason: "CAPABILITY_FENCE_MISSING",
      diagnostic: "The collaboration Run has no persisted capability authorization fence",
    };
  }
  if (context.persistedConfigHash !== context.currentConfigHash) {
    return {
      kind: "DENIED",
      reason: "CAPABILITY_FENCE_CHANGED",
      diagnostic: "The effective Agent configuration changed after this collaboration Run captured its capability fence",
    };
  }
  return effective;
}
