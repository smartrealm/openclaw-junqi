import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRunTransition,
  commandPayloadForHash,
  computePartialClosure,
  parseAndValidatePlan,
  parseWorkerResult,
  validateWriteEnvelope,
} from "./domain.js";
import { CollaborationError } from "./errors.js";
import { InstanceIdentitySpecification } from "./instance-identity-specification.js";
import { PERSISTENCE_LIMITS } from "./persistence-policy.js";
import { sha256 } from "./util.js";

test("run state machine rejects terminal rollback", () => {
  assert.doesNotThrow(() => assertRunTransition("RUNNING", "SYNTHESIZING"));
  assert.throws(() => assertRunTransition("COMPLETED", "RUNNING"), /cannot transition/);
});

test("write envelope verifies a stable payload hash", () => {
  const identity = new InstanceIdentitySpecification("instance-1");
  const params = {
    commandId: "cmd-1",
    expectedCollaborationInstanceId: "instance-1",
    runId: "run-1",
    expectedRunRevision: 3,
    payloadHash: "",
  };
  params.payloadHash = sha256(commandPayloadForHash(params));
  assert.equal(validateWriteEnvelope(params, identity).expectedRunRevision, 3);
  assert.throws(() => validateWriteEnvelope({ ...params, runId: "run-2" }, identity), /payloadHash/);
  assert.throws(
    () => validateWriteEnvelope({
      ...params,
      expectedCollaborationInstanceId: "instance-stale",
    }, identity),
    (error: unknown) => error instanceof CollaborationError && error.code === "INSTANCE_MISMATCH",
  );
  assert.throws(
    () => validateWriteEnvelope({
      ...params,
      expectedCollaborationInstanceId: undefined,
    }, identity),
    (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
  );
});

test("write envelope enforces command id limits by UTF-8 bytes", () => {
  const identity = new InstanceIdentitySpecification("instance-1");
  const params = {
    commandId: "命".repeat(171),
    expectedCollaborationInstanceId: "instance-1",
    runId: "run-1",
    expectedRunRevision: 3,
    payloadHash: "",
  };
  params.payloadHash = sha256(commandPayloadForHash(params));
  assert.throws(
    () => validateWriteEnvelope(params, identity),
    (error: unknown) => error instanceof CollaborationError
      && error.code === "CAPACITY_EXCEEDED"
      && error.details?.actualBytes === 513,
  );
});

test("plan validation enforces authorization and DAG acyclicity", () => {
  const base = {
    goal: "Review a proposal",
    workItems: [
      {
        id: "research",
        title: "Research",
        inputScope: ["proposal"],
        dependencies: [],
        requiredCapabilities: ["web"],
        candidateAgentIds: ["analyst"],
        acceptanceCriteria: ["Sources are cited"],
        riskLevel: "LOW",
        sideEffectClass: "READ_ONLY",
      },
      {
        id: "review",
        title: "Review",
        inputScope: ["research"],
        dependencies: ["research"],
        requiredCapabilities: [],
        candidateAgentIds: ["reviewer"],
        acceptanceCriteria: ["Risks are classified"],
        riskLevel: "MEDIUM",
        sideEffectClass: "READ_ONLY",
      },
    ],
    synthesis: { requiredEvidence: ["sources"], finalAnswerContract: "Concise report" },
  };
  const plan = parseAndValidatePlan(base, {
    allowedAgentIds: new Set(["analyst", "reviewer"]),
    maxWorkItems: 10,
    goal: base.goal,
  });
  assert.equal(plan.workItems.length, 2);
  assert.throws(
    () =>
      parseAndValidatePlan(
        {
          ...base,
          workItems: [
            { ...base.workItems[0], dependencies: ["review"] },
            { ...base.workItems[1], dependencies: ["research"] },
          ],
        },
        { allowedAgentIds: new Set(["analyst", "reviewer"]), maxWorkItems: 10, goal: base.goal },
      ),
    /cycle/,
  );
});

test("plan validation accepts the physical work-item limit and rejects one more", () => {
  const workItem = (index: number) => ({
    id: `item-${index}`,
    title: `Item ${index}`,
    inputScope: ["origin"],
    dependencies: [],
    requiredCapabilities: [],
    candidateAgentIds: ["analyst"],
    acceptanceCriteria: ["Complete"],
    riskLevel: "LOW",
    sideEffectClass: "READ_ONLY",
  });
  const input = (count: number) => ({
    goal: "Review a proposal",
    workItems: Array.from({ length: count }, (_, index) => workItem(index)),
    synthesis: { requiredEvidence: [], finalAnswerContract: "Concise report" },
  });
  const options = {
    allowedAgentIds: new Set(["analyst"]),
    maxWorkItems: PERSISTENCE_LIMITS.workItemArrayItems + 1,
    goal: "Review a proposal",
  };
  assert.equal(parseAndValidatePlan(input(PERSISTENCE_LIMITS.workItemArrayItems), options).workItems.length, 64);
  assert.throws(
    () => parseAndValidatePlan(input(PERSISTENCE_LIMITS.workItemArrayItems + 1), options),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
  );
});

test("partial closure includes all blocked descendants", () => {
  assert.deepEqual(
    computePartialClosure(
      [
        { id: "a", dependencies: [], status: "RUNNING" },
        { id: "b", dependencies: ["a"], status: "BLOCKED" },
        { id: "c", dependencies: ["b"], status: "BLOCKED" },
        { id: "d", dependencies: [], status: "SUCCEEDED" },
      ],
      ["a"],
    ),
    { waiveIds: ["a"], blockedDescendantIds: ["b", "c"], activeIds: ["a"] },
  );
});

test("partial closure rejects an empty selection and exposes UNKNOWN attempts as active", () => {
  assert.throws(
    () => computePartialClosure([{ id: "a", dependencies: [], status: "NEEDS_INTERVENTION" }], []),
    (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
  );
  assert.deepEqual(
    computePartialClosure(
      [{ id: "a", dependencies: [], status: "NEEDS_INTERVENTION", activeAttempt: true }],
      ["a"],
    ),
    { waiveIds: ["a"], blockedDescendantIds: [], activeIds: ["a"] },
  );
});

test("worker result accepts fenced JSON and preserves evidence", () => {
  const result = parseWorkerResult(
    '```json\n{"summary":"done","outcome":"SUCCEEDED","evidence":[{"type":"source","title":"T","reference":"R","verification":"V"}],"createdArtifacts":[],"handoffNotes":[]}\n```',
  );
  assert.equal(result.evidence[0]?.reference, "R");
});

test("plan and worker parsers discard prompt, reasoning, token, and raw tool-output fields", () => {
  const parsedPlan = parseAndValidatePlan({
    goal: "Review a proposal",
    prompt: "PRIVATE_PLANNER_PROMPT",
    reasoning: "PRIVATE_PLANNER_REASONING",
    token: "PRIVATE_TOKEN",
    workItems: [{
      id: "review",
      title: "Review",
      inputScope: ["proposal"],
      dependencies: [],
      requiredCapabilities: ["analysis"],
      candidateAgentIds: ["analyst"],
      acceptanceCriteria: ["Risks are classified"],
      riskLevel: "LOW",
      sideEffectClass: "READ_ONLY",
      systemPrompt: "PRIVATE_WORK_ITEM_PROMPT",
      toolOutput: "PRIVATE_UNBOUNDED_OUTPUT",
    }],
    synthesis: {
      requiredEvidence: ["risk summary"],
      finalAnswerContract: "Return a concise report",
      chainOfThought: "PRIVATE_SYNTHESIS_REASONING",
    },
  }, {
    allowedAgentIds: new Set(["analyst"]),
    maxWorkItems: 10,
    goal: "Review a proposal",
  });
  const planJson = JSON.stringify(parsedPlan);
  assert.doesNotMatch(planJson, /PRIVATE_|prompt|reasoning|token|toolOutput|chainOfThought/i);

  const parsedResult = parseWorkerResult({
    summary: "Reviewed",
    outcome: "SUCCEEDED",
    evidence: [{
      type: "analysis",
      title: "Risk review",
      reference: "artifact:risk-review",
      verification: "Checked against the acceptance criteria",
      reasoning: "PRIVATE_EVIDENCE_REASONING",
      rawOutput: "PRIVATE_TOOL_OUTPUT",
    }],
    createdArtifacts: ["artifact:risk-review"],
    handoffNotes: ["One material risk remains"],
    prompt: "PRIVATE_WORKER_PROMPT",
    chainOfThought: "PRIVATE_WORKER_REASONING",
    token: "PRIVATE_WORKER_TOKEN",
  });
  const resultJson = JSON.stringify(parsedResult);
  assert.doesNotMatch(resultJson, /PRIVATE_|prompt|reasoning|token|rawOutput|chainOfThought/i);
  assert.equal(parsedResult.summary, "Reviewed");
  assert.equal(parsedResult.evidence[0]?.verification, "Checked against the acceptance criteria");
});

test("plan and worker business fields fail closed instead of being truncated", () => {
  const oversizedTitle = "x".repeat(PERSISTENCE_LIMITS.workItemTitleBytes + 1);
  assert.throws(
    () => parseAndValidatePlan({
      goal: "Review a proposal",
      workItems: [{
        id: "review",
        title: oversizedTitle,
        inputScope: ["proposal"],
        dependencies: [],
        requiredCapabilities: [],
        candidateAgentIds: ["analyst"],
        acceptanceCriteria: ["Risks are classified"],
        riskLevel: "LOW",
        sideEffectClass: "READ_ONLY",
      }],
      synthesis: { requiredEvidence: [], finalAnswerContract: "Concise report" },
    }, {
      allowedAgentIds: new Set(["analyst"]),
      maxWorkItems: 10,
      goal: "Review a proposal",
    }),
    (error: unknown) => error instanceof CollaborationError
      && error.code === "CAPACITY_EXCEEDED"
      && error.details?.actualBytes === PERSISTENCE_LIMITS.workItemTitleBytes + 1,
  );

  const oversizedVerification = "证".repeat(PERSISTENCE_LIMITS.evidenceVerificationBytes);
  assert.throws(
    () => parseWorkerResult({
      summary: "Reviewed",
      outcome: "SUCCEEDED",
      evidence: [{
        type: "analysis",
        title: "Risk review",
        reference: "artifact:risk-review",
        verification: oversizedVerification,
      }],
      createdArtifacts: [],
      handoffNotes: [],
    }),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
  );
});
