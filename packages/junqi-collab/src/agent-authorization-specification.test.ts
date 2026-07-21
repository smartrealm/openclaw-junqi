import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAgentDispatchAuthorization,
  evaluateEffectiveAgentAuthorization,
} from "./agent-authorization-specification.js";
import type { CapabilityAgent } from "./types.js";

const agents: CapabilityAgent[] = [
  { id: "coordinator", runtimeType: "native", allowed: true, coordinator: true },
  { id: "worker", runtimeType: "native", allowed: true, coordinator: false },
];

test("effective authorization requires the requested agent to remain allowed", () => {
  assert.equal(evaluateEffectiveAgentAuthorization(agents, "worker", "ALLOWED_AGENT").kind, "AUTHORIZED");
  assert.deepEqual(
    evaluateEffectiveAgentAuthorization(
      agents.map((agent) => agent.id === "worker" ? { ...agent, allowed: false } : agent),
      "worker",
      "ALLOWED_AGENT",
    ),
    {
      kind: "DENIED",
      reason: "AGENT_NOT_ALLOWED",
      diagnostic: "Agent worker authorization was revoked by the plugin or coordinator spawn policy",
    },
  );
});

test("planner and synthesizer dispatch require the same allowed coordinator identity", () => {
  assert.deepEqual(decideAgentDispatchAuthorization({
    agentId: "coordinator",
    attemptKind: "PLANNER",
    configuredAgents: agents.map((agent) => ({ ...agent, coordinator: agent.id === "worker" })),
    persistedConfigHash: "approved",
    currentConfigHash: "approved",
  }), {
    kind: "DENIED",
    reason: "COORDINATOR_AUTHORIZATION_CHANGED",
    diagnostic: "Agent coordinator is no longer the allowed collaboration coordinator",
  });
});

test("dispatch fails closed when the persisted capability fence is missing or changed", () => {
  assert.equal(decideAgentDispatchAuthorization({
    agentId: "worker",
    attemptKind: "WORKER",
    configuredAgents: agents,
    persistedConfigHash: null,
    currentConfigHash: "current",
  }).reason, "CAPABILITY_FENCE_MISSING");
  assert.equal(decideAgentDispatchAuthorization({
    agentId: "worker",
    attemptKind: "WORKER",
    configuredAgents: agents,
    persistedConfigHash: "approved",
    currentConfigHash: "changed",
  }).reason, "CAPABILITY_FENCE_CHANGED");
});
