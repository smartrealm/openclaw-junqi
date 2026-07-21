import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import { PERSISTENCE_LIMITS } from "./persistence-policy.js";
import {
  PartialDecisionSpecification,
  type PartialDecisionGuardedMutation,
} from "./partial-decision-specification.js";

const specification = new PartialDecisionSpecification();

test("logical id selection is non-empty, canonical, unique, and bounded", () => {
  assert.deepEqual(
    specification.selectLogicalIds([" review ", "research", "review"], "workItemIds"),
    ["research", "review"],
  );

  for (const value of [undefined, "research", [], ["   "], ["not/a/logical-id"]]) {
    assert.throws(
      () => specification.selectLogicalIds(value, "workItemIds"),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
  }

  assert.throws(
    () => specification.selectLogicalIds(
      Array.from({ length: PERSISTENCE_LIMITS.workItemArrayItems + 1 }, (_, index) => `work-${index}`),
      "workItemIds",
    ),
    (error: unknown) => (
      error instanceof CollaborationError
      && error.code === "CAPACITY_EXCEEDED"
      && error.details?.actualItems === PERSISTENCE_LIMITS.workItemArrayItems + 1
    ),
  );
  assert.throws(
    () => specification.selectLogicalIds(["a".repeat(65)], "workItemIds"),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
  );
});

test("durable partial decision must reference the exact current plan revision", () => {
  assert.doesNotThrow(() => specification.assertDurableDecisionCurrent(
    { decisionId: "decision-1", planRevisionId: "plan-current" },
    { currentPlanRevisionId: "plan-current" },
  ));

  for (const [planRevisionId, currentPlanRevisionId] of [
    [undefined, "plan-current"],
    ["", "plan-current"],
    [" plan-current ", "plan-current"],
    ["plan-old", "plan-current"],
    ["plan-current", null],
  ] as const) {
    assert.throws(
      () => specification.assertDurableDecisionCurrent(
        { decisionId: "decision-1", planRevisionId },
        { currentPlanRevisionId },
      ),
      (error: unknown) => (
        error instanceof CollaborationError
        && error.code === "REVISION_CONFLICT"
        && error.details?.decisionId === "decision-1"
      ),
    );
  }

  assert.throws(
    () => specification.assertDurableDecisionCurrent(
      { decisionId: "decision-1", planRevisionId: "x".repeat(PERSISTENCE_LIMITS.externalReferenceBytes + 1) },
      { currentPlanRevisionId: "plan-current" },
    ),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
  );
});

test("pending partial decision fences work-item mutation and plan revision", () => {
  const mutations: PartialDecisionGuardedMutation[] = ["WORK_ITEM_MUTATION", "PLAN_REVISION"];
  for (const mutation of mutations) {
    assert.doesNotThrow(() => specification.assertMutationAllowed(false, mutation));
    assert.throws(
      () => specification.assertMutationAllowed(true, mutation),
      (error: unknown) => (
        error instanceof CollaborationError
        && error.code === "INVALID_TRANSITION"
        && error.details?.mutation === mutation
        && error.message.includes("pending partial decision")
      ),
    );
  }
});

test("durable partial payload decoding is strict and fail-closed", () => {
  const valid = {
    planRevisionId: "plan-current",
    closure: {
      waiveIds: ["research"],
      blockedDescendantIds: ["report"],
      activeIds: ["research"],
    },
  };
  assert.deepEqual(specification.decodeDurablePayload(valid), valid);

  const invalidValues: unknown[] = [
    null,
    { ...valid, closure: { ...valid.closure, waiveIds: "research" } },
    { ...valid, closure: { ...valid.closure, waiveIds: [] } },
    { ...valid, closure: { ...valid.closure, waiveIds: ["research", "research"] } },
    { ...valid, closure: { ...valid.closure, activeIds: ["unrelated"] } },
    { ...valid, closure: { ...valid.closure, waiveIds: ["research"], blockedDescendantIds: ["research"] } },
    { ...valid, unexpected: true },
  ];
  for (const value of invalidValues) {
    assert.throws(
      () => specification.decodeDurablePayload(value),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_RESPONSE",
    );
  }
});
