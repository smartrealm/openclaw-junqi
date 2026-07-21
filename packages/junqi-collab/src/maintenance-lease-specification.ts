import { PERSISTENCE_LIMITS, boundedDiagnostic, byteLength } from "./persistence-policy.js";
import { sha256, stableStringify } from "./util.js";

export type MaintenanceLeaseStatus = "ACTIVE" | "EXPIRED";
export type MaintenanceGateStatus = "INACTIVE" | MaintenanceLeaseStatus | "MALFORMED";

export interface MaintenanceLease {
  version: 1;
  id: string;
  reason: string;
  owner: string;
  enteredAt: number;
  expiresAt: number;
  status: MaintenanceLeaseStatus;
  expiredAt?: number;
}

interface MaintenanceLeaseInspectionBase {
  gateActive: boolean;
  recoveryRequired: boolean;
  status: MaintenanceGateStatus;
}

export type MaintenanceLeaseInspection =
  | (MaintenanceLeaseInspectionBase & {
      kind: "ABSENT";
      gateActive: false;
      recoveryRequired: false;
      status: "INACTIVE";
      lease: null;
      raw: null;
    })
  | (MaintenanceLeaseInspectionBase & {
      kind: "VALID";
      gateActive: true;
      lease: MaintenanceLease;
      raw: string;
      transitionRequired: boolean;
    })
  | (MaintenanceLeaseInspectionBase & {
      kind: "MALFORMED";
      gateActive: true;
      recoveryRequired: true;
      status: "MALFORMED";
      lease: null;
      raw: string;
      diagnostic: string;
      rawDigest: string;
    });

const MAX_SERIALIZED_LEASE_BYTES =
  PERSISTENCE_LIMITS.commandIdBytes
  + PERSISTENCE_LIMITS.maintenanceReasonBytes
  + PERSISTENCE_LIMITS.actorBytes
  + 1_024;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const SUPPORTED_KEYS = new Set([
  "version",
  "id",
  "reason",
  "owner",
  "enteredAt",
  "expiresAt",
  "status",
  "expiredAt",
]);

/**
 * Pure policy for interpreting the durable maintenance lease. Invalid state is
 * represented as a fail-closed inspection instead of escaping as a parse error.
 */
export class MaintenanceLeaseSpecification {
  inspect(raw: string | null, referenceTime: number): MaintenanceLeaseInspection {
    assertReferenceTime(referenceTime);
    if (raw == null) {
      return {
        kind: "ABSENT",
        gateActive: false,
        recoveryRequired: false,
        status: "INACTIVE",
        lease: null,
        raw: null,
      };
    }

    try {
      if (byteLength(raw) > MAX_SERIALIZED_LEASE_BYTES) {
        throw new TypeError(`serialized lease exceeds ${MAX_SERIALIZED_LEASE_BYTES} bytes`);
      }
      const parsed = JSON.parse(raw) as unknown;
      const lease = this.normalize(parsed);
      const transitionRequired = lease.status === "ACTIVE" && lease.expiresAt <= referenceTime;
      return {
        kind: "VALID",
        gateActive: true,
        recoveryRequired: lease.status === "EXPIRED" || transitionRequired,
        status: transitionRequired ? "EXPIRED" : lease.status,
        lease,
        raw,
        transitionRequired,
      };
    } catch (error) {
      return {
        kind: "MALFORMED",
        gateActive: true,
        recoveryRequired: true,
        status: "MALFORMED",
        lease: null,
        raw,
        diagnostic: boundedDiagnostic(error),
        rawDigest: sha256(raw),
      };
    }
  }

  createActive(params: {
    id: string;
    reason: string;
    owner: string;
    enteredAt: number;
    expiresAt: number;
  }): MaintenanceLease {
    return this.normalize({ ...params, version: 1, status: "ACTIVE" });
  }

  expire(lease: MaintenanceLease, referenceTime: number): MaintenanceLease {
    assertReferenceTime(referenceTime);
    if (lease.status !== "ACTIVE") throw new TypeError("maintenance lease is not active");
    if (lease.expiresAt > referenceTime) throw new TypeError("maintenance lease has not expired");
    return this.normalize({ ...lease, status: "EXPIRED", expiredAt: referenceTime });
  }

  serialize(lease: MaintenanceLease): string {
    const normalized = this.normalize(lease);
    return stableStringify(normalized);
  }

  private normalize(value: unknown): MaintenanceLease {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("maintenance lease must be an object");
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!SUPPORTED_KEYS.has(key)) throw new TypeError(`maintenance lease contains unsupported field ${key}`);
    }

    const hasVersion = Object.hasOwn(record, "version");
    const hasStatus = Object.hasOwn(record, "status");
    if (hasVersion !== hasStatus) {
      throw new TypeError("maintenance lease version and status must be persisted together");
    }
    if (hasVersion && record.version !== 1) throw new TypeError("maintenance lease version is unsupported");

    const status = hasStatus ? record.status : "ACTIVE";
    if (status !== "ACTIVE" && status !== "EXPIRED") {
      throw new TypeError("maintenance lease status is invalid");
    }
    const id = requiredBoundedString(record.id, "id", PERSISTENCE_LIMITS.commandIdBytes);
    const reason = requiredBoundedString(record.reason, "reason", PERSISTENCE_LIMITS.maintenanceReasonBytes);
    const owner = requiredBoundedString(record.owner, "owner", PERSISTENCE_LIMITS.actorBytes);
    const enteredAt = nonNegativeSafeInteger(record.enteredAt, "enteredAt");
    const expiresAt = nonNegativeSafeInteger(record.expiresAt, "expiresAt");
    if (expiresAt <= enteredAt) throw new TypeError("maintenance lease expiresAt must be later than enteredAt");

    if (status === "ACTIVE") {
      if (record.expiredAt != null) throw new TypeError("active maintenance lease cannot have expiredAt");
      return { version: 1, id, reason, owner, enteredAt, expiresAt, status };
    }

    const expiredAt = nonNegativeSafeInteger(record.expiredAt, "expiredAt");
    if (expiredAt < expiresAt) throw new TypeError("maintenance lease expiredAt precedes expiresAt");
    return { version: 1, id, reason, owner, enteredAt, expiresAt, status, expiredAt };
  }
}

function requiredBoundedString(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`maintenance lease ${field} must be a trimmed non-empty string`);
  }
  if (CONTROL_CHARACTER.test(value)) throw new TypeError(`maintenance lease ${field} contains control characters`);
  if (byteLength(value) > maxBytes) throw new TypeError(`maintenance lease ${field} exceeds ${maxBytes} bytes`);
  return value;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`maintenance lease ${field} must be a non-negative safe integer`);
  }
  return value;
}

function assertReferenceTime(referenceTime: number): void {
  if (!Number.isSafeInteger(referenceTime) || referenceTime < 0) {
    throw new TypeError("maintenance lease referenceTime must be a non-negative safe integer");
  }
}
