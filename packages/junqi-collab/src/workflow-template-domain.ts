import { parseAndValidatePlan } from "./domain.js";
import { CollaborationError, assertCondition } from "./errors.js";
import { PERSISTENCE_LIMITS, assertBoundedJson, assertBoundedText } from "./persistence-policy.js";
import type { CollaborationPlan, PlanWorkItem } from "./types.js";
import { parseJsonObject, readString } from "./util.js";

export const WORKFLOW_TEMPLATE_SCHEMA_VERSION = 1;

const TEMPLATE_VALIDATION_AGENT_ID = "workflow-template-agent";

export type WorkflowTemplateWorkItem = Omit<PlanWorkItem, "candidateAgentIds">;

/**
 * A template owns only the logical DAG. Concrete Agent selection is intentionally
 * deferred to Run approval, when the current OpenClaw capability fence is known.
 */
export interface WorkflowTemplateDefinition {
  schemaVersion: typeof WORKFLOW_TEMPLATE_SCHEMA_VERSION;
  goal: string;
  workItems: WorkflowTemplateWorkItem[];
  synthesis: CollaborationPlan["synthesis"];
}

function planWithValidationAgent(value: unknown): Record<string, unknown> {
  const source = parseJsonObject(value, "workflow template definition");
  assertCondition(Array.isArray(source.workItems), "INVALID_REQUEST", "workflow template workItems must be an array");
  return {
    ...source,
    workItems: source.workItems.map((item, index) => {
      const workItem = parseJsonObject(item, `workflow template workItems[${index}]`);
      return { ...workItem, candidateAgentIds: [TEMPLATE_VALIDATION_AGENT_ID] };
    }),
  };
}

function definitionFromValidatedPlan(plan: CollaborationPlan): WorkflowTemplateDefinition {
  return {
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
    goal: plan.goal,
    workItems: plan.workItems.map(({ candidateAgentIds: _candidateAgentIds, ...item }) => ({ ...item })),
    synthesis: {
      requiredEvidence: [...plan.synthesis.requiredEvidence],
      finalAnswerContract: plan.synthesis.finalAnswerContract,
    },
  };
}

/** Validate a stored or proposed template without accepting stale Agent identities. */
export function parseWorkflowTemplateDefinition(
  value: unknown,
  options: { maxWorkItems: number },
): WorkflowTemplateDefinition {
  assertBoundedJson(value, "workflow template definition", PERSISTENCE_LIMITS.workflowTemplateDefinitionBytes);
  const source = parseJsonObject(value, "workflow template definition");
  assertCondition(
    source.schemaVersion === WORKFLOW_TEMPLATE_SCHEMA_VERSION,
    "INVALID_REQUEST",
    "workflow template schemaVersion is unsupported",
  );
  const plan = parseAndValidatePlan(planWithValidationAgent(source), {
    allowedAgentIds: new Set([TEMPLATE_VALIDATION_AGENT_ID]),
    maxWorkItems: options.maxWorkItems,
    goal: readString(source.goal, "workflow template goal"),
  });
  return definitionFromValidatedPlan(plan);
}

/** Convert a completed Run plan into an Agent-independent reusable definition. */
export function workflowTemplateDefinitionFromPlan(
  plan: unknown,
  options: { maxWorkItems: number },
): WorkflowTemplateDefinition {
  const source = parseJsonObject(plan, "source plan");
  return parseWorkflowTemplateDefinition(
    {
      schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      goal: source.goal,
      workItems: source.workItems,
      synthesis: source.synthesis,
    },
    options,
  );
}

/**
 * Materialization is capability-aware. No template can cause a dispatch until
 * the current OpenClaw Agent set has been resolved and approved.
 */
export function materializeWorkflowTemplatePlan(
  definitionInput: unknown,
  options: {
    goal: string;
    allowedAgentIds: ReadonlySet<string>;
    maxWorkItems: number;
  },
): CollaborationPlan {
  const definition = parseWorkflowTemplateDefinition(definitionInput, {
    maxWorkItems: options.maxWorkItems,
  });
  const goal = options.goal.trim() || definition.goal;
  assertBoundedText(goal, "workflow template run goal", PERSISTENCE_LIMITS.goalBytes);
  const candidateAgentIds = [...options.allowedAgentIds].sort();
  assertCondition(candidateAgentIds.length > 0, "CAPABILITY_CHANGED", "No OpenClaw Agents are currently allowed for this template");
  return parseAndValidatePlan(
    {
      goal,
      workItems: definition.workItems.map((item) => ({ ...item, candidateAgentIds })),
      synthesis: definition.synthesis,
    },
    {
      allowedAgentIds: options.allowedAgentIds,
      maxWorkItems: options.maxWorkItems,
      goal,
    },
  );
}

export function assertWorkflowTemplateName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CollaborationError("INVALID_REQUEST", "workflow template name is required");
  }
  return assertBoundedText(value.trim(), "workflow template name", PERSISTENCE_LIMITS.workflowTemplateNameBytes);
}
