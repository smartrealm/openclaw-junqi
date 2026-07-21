import { CollaborationError, assertCondition } from "./errors.js";
import { PERSISTENCE_LIMITS, assertPersistableText } from "./persistence-policy.js";
import type { OriginRef } from "./types.js";

function readInstanceId(value: unknown, field: string): string {
  assertCondition(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_REQUEST",
    `${field} must be a non-empty string`,
  );
  return assertPersistableText(
    value.trim(),
    field,
    PERSISTENCE_LIMITS.originRuntimeIdBytes,
  );
}

/**
 * Authoritative instance-identity policy for every collaboration write.
 *
 * The instance id is captured once from the opened database. Callers must
 * carry that exact value through hashing, persistence and response decoding;
 * an old command is never rebound to a replacement database.
 */
export class InstanceIdentitySpecification {
  readonly collaborationInstanceId: string;

  constructor(collaborationInstanceId: string) {
    this.collaborationInstanceId = readInstanceId(collaborationInstanceId, "collaborationInstanceId");
  }

  assertExpected(value: unknown, field = "expectedCollaborationInstanceId"): string {
    const expected = readInstanceId(value, field);
    if (expected !== this.collaborationInstanceId) {
      throw new CollaborationError(
        "INSTANCE_MISMATCH",
        "The collaboration database instance changed before the command was accepted",
        {
          expectedCollaborationInstanceId: expected,
          actualCollaborationInstanceId: this.collaborationInstanceId,
        },
      );
    }
    return expected;
  }

  assertRuntimeId(value: unknown, field = "runtimeId"): string {
    const runtimeId = readInstanceId(value, field);
    if (runtimeId !== this.collaborationInstanceId) {
      throw new CollaborationError(
        "INSTANCE_MISMATCH",
        "The requested runtime does not belong to this collaboration database instance",
        {
          expectedCollaborationInstanceId: runtimeId,
          actualCollaborationInstanceId: this.collaborationInstanceId,
          field,
        },
      );
    }
    return runtimeId;
  }

  bindOrigin(origin: OriginRef): OriginRef {
    return { ...origin, runtimeId: this.collaborationInstanceId };
  }

  stampResponse(response: Record<string, unknown>): Record<string, unknown> {
    return { ...response, collaborationInstanceId: this.collaborationInstanceId };
  }
}
