import { CollaborationDatabase } from "./database.js";
import {
  MaintenanceLeaseSpecification,
  type MaintenanceLease,
  type MaintenanceLeaseInspection,
} from "./maintenance-lease-specification.js";
import { nowMs } from "./util.js";

const MAINTENANCE_LEASE_KEY = "maintenance_lease";

export type MaintenanceLeaseReleaseResult =
  | { kind: "RELEASED"; lease: MaintenanceLease }
  | { kind: "ABSENT" }
  | { kind: "MALFORMED"; inspection: Extract<MaintenanceLeaseInspection, { kind: "MALFORMED" }> }
  | { kind: "MISMATCH"; lease: MaintenanceLease };

/**
 * Persistence boundary for the singleton lease. Compare-and-set writes keep
 * recovery deterministic if multiple service instances inspect the same DB.
 */
export class MaintenanceLeaseRepository {
  constructor(
    private readonly database: CollaborationDatabase,
    private readonly specification = new MaintenanceLeaseSpecification(),
    private readonly clock: () => number = nowMs,
  ) {}

  inspect(referenceTime = this.clock()): MaintenanceLeaseInspection {
    return this.specification.inspect(this.database.getMetadata(MAINTENANCE_LEASE_KEY), referenceTime);
  }

  create(lease: MaintenanceLease): boolean {
    const result = this.database.db
      .prepare("INSERT OR IGNORE INTO metadata(key, value, updated_at) VALUES (?, ?, ?)")
      .run(MAINTENANCE_LEASE_KEY, this.specification.serialize(lease), this.clock());
    return Number(result.changes) === 1;
  }

  recoverExpired(
    referenceTime: number,
    onExpired: (lease: MaintenanceLease) => void,
  ): MaintenanceLeaseInspection {
    return this.database.transaction(() => {
      const current = this.inspect(referenceTime);
      if (current.kind !== "VALID" || !current.transitionRequired) return current;

      const expired = this.specification.expire(current.lease, referenceTime);
      const serialized = this.specification.serialize(expired);
      const changed = this.database.db
        .prepare("UPDATE metadata SET value = ?, updated_at = ? WHERE key = ? AND value = ?")
        .run(serialized, referenceTime, MAINTENANCE_LEASE_KEY, current.raw);
      if (Number(changed.changes) !== 1) return this.inspect(referenceTime);

      onExpired(expired);
      return this.specification.inspect(serialized, referenceTime);
    });
  }

  releaseExact(
    leaseId: string,
    owner: string,
    referenceTime = this.clock(),
  ): MaintenanceLeaseReleaseResult {
    return this.database.transaction(() => {
      const current = this.inspect(referenceTime);
      if (current.kind === "ABSENT") return { kind: "ABSENT" };
      if (current.kind === "MALFORMED") return { kind: "MALFORMED", inspection: current };
      if (current.lease.id !== leaseId || current.lease.owner !== owner) {
        return { kind: "MISMATCH", lease: current.lease };
      }

      const deleted = this.database.db
        .prepare("DELETE FROM metadata WHERE key = ? AND value = ?")
        .run(MAINTENANCE_LEASE_KEY, current.raw);
      return Number(deleted.changes) === 1
        ? { kind: "RELEASED", lease: current.lease }
        : { kind: "MISMATCH", lease: current.lease };
    });
  }
}
