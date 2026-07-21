import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import {
  materializeWorkflowTemplatePlan,
  workflowTemplateDefinitionFromPlan,
} from "./workflow-template-domain.js";

const sourcePlan = {
  goal: "Assess a launch proposal",
  workItems: [
    {
      id: "research",
      title: "Research the proposal",
      inputScope: ["origin message"],
      dependencies: [],
      requiredCapabilities: ["analysis"],
      candidateAgentIds: ["retired-agent"],
      acceptanceCriteria: ["Evidence is explicit"],
      riskLevel: "LOW",
      sideEffectClass: "READ_ONLY",
    },
    {
      id: "review",
      title: "Review the research",
      inputScope: ["research evidence"],
      dependencies: ["research"],
      requiredCapabilities: ["review"],
      candidateAgentIds: ["retired-agent"],
      acceptanceCriteria: ["Risks are classified"],
      riskLevel: "LOW",
      sideEffectClass: "READ_ONLY",
    },
  ],
  synthesis: {
    requiredEvidence: ["research", "review"],
    finalAnswerContract: "Return a concise recommendation",
  },
};

test("workflow templates retain the logical DAG but never stale candidate Agents", () => {
  const definition = workflowTemplateDefinitionFromPlan(sourcePlan, { maxWorkItems: 10 });

  assert.equal(definition.schemaVersion, 1);
  assert.deepEqual(definition.workItems.map((item) => item.dependencies), [[], ["research"]]);
  assert.equal("candidateAgentIds" in definition.workItems[0]!, false);
  assert.equal("candidateAgentIds" in definition.workItems[1]!, false);

  const plan = materializeWorkflowTemplatePlan(definition, {
    goal: "Assess this week's launch proposal",
    allowedAgentIds: new Set(["coordinator", "current-worker"]),
    maxWorkItems: 10,
  });
  assert.equal(plan.goal, "Assess this week's launch proposal");
  assert.deepEqual(plan.workItems.map((item) => item.candidateAgentIds), [
    ["coordinator", "current-worker"],
    ["coordinator", "current-worker"],
  ]);
});

test("workflow template materialization fails closed when OpenClaw exposes no allowed Agent", () => {
  const definition = workflowTemplateDefinitionFromPlan(sourcePlan, { maxWorkItems: 10 });
  assert.throws(
    () => materializeWorkflowTemplatePlan(definition, {
      goal: sourcePlan.goal,
      allowedAgentIds: new Set(),
      maxWorkItems: 10,
    }),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPABILITY_CHANGED",
  );
});
