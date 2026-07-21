import { CollaborationError, assertCondition } from "./errors.js";
import {
  PERSISTENCE_LIMITS,
  assertBoundedText,
} from "./persistence-policy.js";

const LOGICAL_ID_MAX_BYTES = 64;
const LOGICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type PartialDecisionGuardedMutation = "WORK_ITEM_MUTATION" | "PLAN_REVISION";

export interface DurablePartialDecisionPlanFact {
  readonly decisionId: string;
  readonly planRevisionId: unknown;
}

export interface PartialDecisionPlanExpectation {
  readonly currentPlanRevisionId: string | null;
}

export interface DurablePartialDecisionPayload {
  readonly planRevisionId: string;
  readonly closure: {
    readonly waiveIds: readonly string[];
    readonly blockedDescendantIds: readonly string[];
    readonly activeIds: readonly string[];
  };
}

/**
 * Domain Specification for the lifetime of a pending partial-completion decision.
 *
 * A partial decision is a fence over an exact PlanRevision. While it is pending,
 * work-item and plan mutations are forbidden because either mutation would make
 * the operator-approved closure ambiguous.
 */
export class PartialDecisionSpecification {
  selectLogicalIds(value: unknown, field = "logicalIds"): readonly string[] {
    assertCondition(Array.isArray(value), "INVALID_REQUEST", `${field} must be an array`);
    assertCondition(value.length > 0, "INVALID_REQUEST", `${field} must select at least one work item`);
    assertCondition(
      value.length <= PERSISTENCE_LIMITS.workItemArrayItems,
      "CAPACITY_EXCEEDED",
      `${field} exceeds the ${PERSISTENCE_LIMITS.workItemArrayItems}-item limit`,
      {
        field,
        maxItems: PERSISTENCE_LIMITS.workItemArrayItems,
        actualItems: value.length,
      },
    );

    const logicalIds = value.map((candidate, index) => {
      assertCondition(
        typeof candidate === "string" && candidate.trim().length > 0,
        "INVALID_REQUEST",
        `${field}[${index}] must be a non-empty string`,
      );
      const logicalId = candidate.trim();
      assertBoundedText(logicalId, `${field}[${index}]`, LOGICAL_ID_MAX_BYTES);
      assertCondition(
        LOGICAL_ID_PATTERN.test(logicalId),
        "INVALID_REQUEST",
        `${field}[${index}] is not a valid work item logical id`,
      );
      return logicalId;
    });

    return Object.freeze([...new Set(logicalIds)].sort());
  }

  decodeDurablePayload(value: unknown): DurablePartialDecisionPayload {
    assertRecord(value, "partialDecision");
    assertExactKeys(value, ["closure", "planRevisionId"], "partialDecision");
    const planRevisionId = value.planRevisionId;
    assertCondition(
      typeof planRevisionId === "string"
        && planRevisionId.trim() === planRevisionId
        && planRevisionId.length > 0,
      "INVALID_RESPONSE",
      "Persisted partial decision planRevisionId is invalid",
    );
    assertPersistedBoundedText(
      planRevisionId,
      "partialDecision.planRevisionId",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    );

    assertRecord(value.closure, "partialDecision.closure");
    assertExactKeys(
      value.closure,
      ["activeIds", "blockedDescendantIds", "waiveIds"],
      "partialDecision.closure",
    );
    const waiveIds = this.decodeDurableIds(value.closure.waiveIds, "partialDecision.closure.waiveIds", false);
    const blockedDescendantIds = this.decodeDurableIds(
      value.closure.blockedDescendantIds,
      "partialDecision.closure.blockedDescendantIds",
      true,
    );
    const activeIds = this.decodeDurableIds(value.closure.activeIds, "partialDecision.closure.activeIds", true);
    const closureIds = new Set([...waiveIds, ...blockedDescendantIds]);
    assertCondition(
      closureIds.size <= PERSISTENCE_LIMITS.workItemArrayItems,
      "INVALID_RESPONSE",
      "Persisted partial decision closure exceeds its item limit",
    );
    assertCondition(
      waiveIds.every((id) => !blockedDescendantIds.includes(id)),
      "INVALID_RESPONSE",
      "Persisted partial decision closure overlaps waive and blocked ids",
    );
    assertCondition(
      activeIds.every((id) => closureIds.has(id)),
      "INVALID_RESPONSE",
      "Persisted partial decision active ids escape its closure",
    );

    return Object.freeze({
      planRevisionId,
      closure: Object.freeze({
        waiveIds: Object.freeze(waiveIds),
        blockedDescendantIds: Object.freeze(blockedDescendantIds),
        activeIds: Object.freeze(activeIds),
      }),
    });
  }

  private decodeDurableIds(value: unknown, field: string, allowEmpty: boolean): string[] {
    assertCondition(Array.isArray(value), "INVALID_RESPONSE", `Persisted ${field} must be an array`);
    if (!allowEmpty) {
      assertCondition(value.length > 0, "INVALID_RESPONSE", `Persisted ${field} must not be empty`);
    }
    assertCondition(
      value.length <= PERSISTENCE_LIMITS.workItemArrayItems,
      "INVALID_RESPONSE",
      `Persisted ${field} exceeds its item limit`,
    );
    const ids = value.map((candidate, index) => {
      assertCondition(
        typeof candidate === "string" && candidate.trim() === candidate && candidate.length > 0,
        "INVALID_RESPONSE",
        `Persisted ${field}[${index}] is invalid`,
      );
      assertPersistedBoundedText(candidate, `${field}[${index}]`, LOGICAL_ID_MAX_BYTES);
      assertCondition(
        LOGICAL_ID_PATTERN.test(candidate),
        "INVALID_RESPONSE",
        `Persisted ${field}[${index}] is not a valid logical id`,
      );
      return candidate;
    });
    assertCondition(
      new Set(ids).size === ids.length,
      "INVALID_RESPONSE",
      `Persisted ${field} contains duplicate ids`,
    );
    return [...ids].sort();
  }

  assertDurableDecisionCurrent(
    decision: DurablePartialDecisionPlanFact,
    expectation: PartialDecisionPlanExpectation,
  ): void {
    assertBoundedText(
      decision.decisionId,
      "partialDecision.decisionId",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    );
    const decisionPlanRevisionId = typeof decision.planRevisionId === "string"
      ? decision.planRevisionId
      : null;
    if (decisionPlanRevisionId !== null) {
      assertBoundedText(
        decisionPlanRevisionId,
        "partialDecision.planRevisionId",
        PERSISTENCE_LIMITS.externalReferenceBytes,
      );
    }
    if (
      decisionPlanRevisionId === null
      || decisionPlanRevisionId.length === 0
      || expectation.currentPlanRevisionId === null
      || decisionPlanRevisionId !== expectation.currentPlanRevisionId
    ) {
      throw new CollaborationError(
        "REVISION_CONFLICT",
        "Pending partial decision does not belong to the current plan revision",
        {
          decisionId: decision.decisionId,
          decisionPlanRevisionId,
          currentPlanRevisionId: expectation.currentPlanRevisionId,
        },
      );
    }
  }

  assertMutationAllowed(
    pending: boolean,
    mutation: PartialDecisionGuardedMutation,
  ): void {
    if (!pending) return;
    const message = mutation === "PLAN_REVISION"
      ? "Resolve or supersede the pending partial decision before revising the plan"
      : "Resolve or supersede the pending partial decision before mutating a work item";
    throw new CollaborationError("INVALID_TRANSITION", message, { mutation });
  }
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  assertCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_RESPONSE",
    `Persisted ${field} must be an object`,
  );
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  assertCondition(
    actual.length === required.length && actual.every((key, index) => key === required[index]),
    "INVALID_RESPONSE",
    `Persisted ${field} has an unexpected shape`,
  );
}

function assertPersistedBoundedText(value: string, field: string, maxBytes: number): void {
  try {
    assertBoundedText(value, field, maxBytes);
  } catch (error) {
    throw new CollaborationError("INVALID_RESPONSE", `Persisted ${field} exceeds its size contract`, {
      cause: error instanceof Error ? error.message : "bounded-text-validation-failed",
    });
  }
}
