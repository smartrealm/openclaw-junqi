import type { CollaborationDatabase } from "./database.js";

export interface HealthSnapshot {
  readonly databaseIntegrity: string;
  readonly checkedAt: number | null;
}

type DatabaseIntegrityProbe = Pick<CollaborationDatabase, "integrityCheck">;

const UNCHECKED_HEALTH = Object.freeze<HealthSnapshot>({
  databaseIntegrity: "unknown",
  checkedAt: null,
});

function healthSnapshot(databaseIntegrity: string, checkedAt: number): HealthSnapshot {
  return Object.freeze({
    databaseIntegrity: databaseIntegrity || "unknown",
    checkedAt,
  });
}

/**
 * Owns the last explicit database health observation. Hot capability reads use
 * the immutable snapshot; startup and maintenance remain the refresh points.
 */
export class DatabaseHealthMonitor {
  #snapshot: HealthSnapshot = UNCHECKED_HEALTH;

  constructor(
    private readonly database: DatabaseIntegrityProbe,
    private readonly now: () => number = Date.now,
  ) {}

  snapshot(): HealthSnapshot {
    return this.#snapshot;
  }

  refresh(): HealthSnapshot {
    const checkedAt = this.now();
    try {
      this.#snapshot = healthSnapshot(this.database.integrityCheck(), checkedAt);
      return this.#snapshot;
    } catch (error) {
      // Never retain a previously healthy observation after a failed probe.
      this.#snapshot = healthSnapshot("unknown", checkedAt);
      throw error;
    }
  }
}
