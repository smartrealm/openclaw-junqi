import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { chmodSync, existsSync } from "node:fs";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import { newId, nowMs, stableStringify } from "./util.js";

type SqlRow = Record<string, SQLOutputValue>;

interface SchemaShape {
  objects: Array<{ type: string; name: string; sql: string }>;
  tables: Record<string, unknown[]>;
  indexes: Record<string, unknown[]>;
  foreignKeys: Record<string, unknown[]>;
}

interface SchemaObject {
  type: string;
  name: string;
  sql: string;
}

let canonicalShape: SchemaShape | null = null;

const LEGACY_SCHEMA_VERSIONS = new Set([12, 13, 14]);
const LEGACY_SESSION_OBJECTS = [
  "table:session_mutations",
  "table:session_mutation_commands",
  "index:session_mutations_active",
  "index:session_mutations_unresolved",
  "index:session_mutation_commands_mutation",
] as const;
const LEGACY_SCHEMA_13_OBJECTS = [
  "table:deletion_command_receipts",
  "index:deletion_command_receipts_run",
  "table:command_receipt_conflicts",
] as const;
const LEGACY_SCHEMA_12_OBJECTS = [
  "table:workflow_templates",
  "index:workflow_templates_published",
  "table:workflow_template_versions",
  "index:workflow_template_versions_template",
  "table:workflow_run_templates",
  "index:workflow_run_templates_template",
] as const;
const TOMBSTONES_MIGRATION_TABLE = "tombstones_schema_15_migration";

export class UnsupportedCollaborationSchemaError extends Error {
  constructor(
    public readonly actualSchemaVersion: number | null,
    public readonly expectedSchemaVersion: number,
    persistedValue: string | null,
  ) {
    super(
      `database schema ${persistedValue ?? "missing"} is unsupported; expected ${expectedSchemaVersion}`,
    );
    this.name = "UnsupportedCollaborationSchemaError";
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedRows(rows: SqlRow[]): unknown[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  ));
}

function schemaObjects(database: DatabaseSync): SchemaObject[] {
  return (database.prepare(
    `SELECT type, name, sql
     FROM sqlite_master
     WHERE type IN ('table', 'index', 'view', 'trigger')
       AND name NOT LIKE 'sqlite_%'
       AND sql IS NOT NULL
     ORDER BY type, name`,
  ).all() as SqlRow[]).map((row) => ({
    type: String(row.type),
    name: String(row.name),
    sql: String(row.sql).trim(),
  }));
}

function readSchemaShape(database: DatabaseSync): SchemaShape {
  const objects = schemaObjects(database);
  const tables: Record<string, unknown[]> = {};
  const indexes: Record<string, unknown[]> = {};
  const foreignKeys: Record<string, unknown[]> = {};
  for (const object of objects) {
    const name = quoteIdentifier(object.name);
    if (object.type === "table") {
      tables[object.name] = normalizedRows(
        database.prepare(`PRAGMA table_xinfo(${name})`).all() as SqlRow[],
      );
      foreignKeys[object.name] = normalizedRows(
        database.prepare(`PRAGMA foreign_key_list(${name})`).all() as SqlRow[],
      );
      continue;
    }
    indexes[object.name] = normalizedRows(
      database.prepare(`PRAGMA index_xinfo(${name})`).all() as SqlRow[],
    );
  }
  return {
    objects,
    tables,
    indexes,
    foreignKeys,
  };
}

function currentSchemaShape(): SchemaShape {
  if (canonicalShape) return canonicalShape;
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(SCHEMA_SQL);
    canonicalShape = readSchemaShape(database);
    return canonicalShape;
  } finally {
    database.close();
  }
}

function readMetadata(database: DatabaseSync, key: string): string | null {
  const row = database.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as SqlRow | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

function writeMetadata(database: DatabaseSync, key: string, value: string): void {
  database.prepare(
    `INSERT INTO metadata(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowMs());
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function legacySchemaObjectNames(version: number): Set<string> {
  const names = new Set(
    currentSchemaShape().objects.map((object) => `${object.type}:${object.name}`),
  );
  if (version <= 13) names.delete("index:commands_available");
  for (const name of LEGACY_SESSION_OBJECTS) names.add(name);
  if (version === 12) {
    for (const name of LEGACY_SCHEMA_12_OBJECTS) names.delete(name);
  }
  if (version <= 13) {
    for (const name of LEGACY_SCHEMA_13_OBJECTS) names.add(name);
  }
  return names;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function requireNoReceiptConflict(
  database: DatabaseSync,
  sourceTable: "deletion_command_receipts" | "session_mutation_commands",
): void {
  const source = sourceTable === "deletion_command_receipts"
    ? "SELECT command_id, 'LEGACY_DELETE' AS source, run_id, payload_hash, response_json FROM deletion_command_receipts"
    : "SELECT command_id, 'SESSION_MUTATION:' || operation AS source, NULL AS run_id, payload_hash, response_json FROM session_mutation_commands";
  const conflict = database.prepare(
    `SELECT 1
     FROM (${source}) AS legacy
     JOIN command_receipts AS current ON current.command_id = legacy.command_id
     WHERE current.source <> legacy.source
        OR current.run_id IS NOT legacy.run_id
        OR current.payload_hash <> legacy.payload_hash
        OR current.response_json IS NOT legacy.response_json
     LIMIT 1`,
  ).get();
  if (conflict) {
    throw new Error(`legacy ${sourceTable} conflicts with the current command receipt authority`);
  }
}

function copyLegacyReceipts(database: DatabaseSync, version: number): void {
  if (version <= 13) {
    const conflictCount = database.prepare(
      "SELECT COUNT(*) AS count FROM command_receipt_conflicts",
    ).get() as SqlRow;
    if (Number(conflictCount.count) > 0) {
      throw new Error("legacy command receipt conflicts require manual recovery");
    }
    requireNoReceiptConflict(database, "deletion_command_receipts");
    database.exec(`
      INSERT OR IGNORE INTO command_receipts(
        command_id, source, run_id, payload_hash, response_json, created_at, updated_at
      )
      SELECT command_id, 'LEGACY_DELETE', run_id, payload_hash, response_json, created_at, updated_at
      FROM deletion_command_receipts;
    `);
  }

  requireNoReceiptConflict(database, "session_mutation_commands");
  database.exec(`
    INSERT OR IGNORE INTO command_receipts(
      command_id, source, run_id, payload_hash, response_json, created_at, updated_at
    )
    SELECT command_id, 'SESSION_MUTATION:' || operation, NULL, payload_hash, response_json, created_at, updated_at
    FROM session_mutation_commands;
  `);
}

function rebuildTombstones(database: DatabaseSync): void {
  const invalid = database.prepare(
    "SELECT 1 FROM tombstones WHERE deletion_job_id IS NULL AND actor <> 'retention-policy' LIMIT 1",
  ).get();
  if (invalid) {
    throw new Error("legacy tombstone violates the current deletion authority constraint");
  }
  database.exec(`
    DROP INDEX tombstones_deleted_at;
    ALTER TABLE tombstones RENAME TO ${TOMBSTONES_MIGRATION_TABLE};
  `);
  database.exec(SCHEMA_SQL);
  database.exec(`
    INSERT INTO tombstones(
      id, run_id, actor, content_digest, deletion_job_id, deleted_at,
      cleanup_status, cleanup_error, cleanup_updated_at,
      flow_reconciliation_command_id, openclaw_flow_id, openclaw_flow_revision,
      flow_reconciliation_diagnostic, flow_reconciliation_abandoned_at,
      flow_reconciliation_abandon_reason
    )
    SELECT
      id, run_id, actor, content_digest, deletion_job_id, deleted_at,
      cleanup_status, cleanup_error, cleanup_updated_at,
      flow_reconciliation_command_id, openclaw_flow_id, openclaw_flow_revision,
      flow_reconciliation_diagnostic, flow_reconciliation_abandoned_at,
      flow_reconciliation_abandon_reason
    FROM ${TOMBSTONES_MIGRATION_TABLE};
    DROP TABLE ${TOMBSTONES_MIGRATION_TABLE};
  `);
}

export class CollaborationSchemaInitializer {
  constructor(
    private readonly database: DatabaseSync,
    private readonly databasePath: string,
  ) {}

  initialize(): string {
    const objects = schemaObjects(this.database);
    const legacyVersion = this.legacyVersionForMigration(objects);
    const backupDataVersion = legacyVersion === null
      ? null
      : this.backupLegacyDatabase(legacyVersion);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (backupDataVersion !== null && this.dataVersion() !== backupDataVersion) {
        throw new Error("collaboration database changed while its legacy backup was being created");
      }
      const instanceId = objects.length === 0
        ? this.createCurrentSchema()
        : legacyVersion === null
          ? this.verifyCurrentSchema(objects)
          : this.migrateLegacySchema(legacyVersion);
      this.database.exec("COMMIT");
      return instanceId;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // 保留原始 schema 校验错误，避免回滚异常覆盖根因。
      }
      throw error;
    }
  }

  private createCurrentSchema(): string {
    this.database.exec(SCHEMA_SQL);
    const instanceId = newId("instance");
    writeMetadata(this.database, "schema_version", String(SCHEMA_VERSION));
    writeMetadata(this.database, "collaboration_instance_id", instanceId);
    this.assertCanonicalShape();
    return instanceId;
  }

  private verifyCurrentSchema(objects: SchemaObject[]): string {
    const hasMetadata = objects.some(
      (object) => object.type === "table" && object.name === "metadata",
    );
    if (!hasMetadata) {
      throw new Error("collaboration database metadata is missing");
    }

    const persistedVersion = readMetadata(this.database, "schema_version");
    const version = persistedVersion == null ? Number.NaN : Number(persistedVersion);
    if (!Number.isSafeInteger(version) || version !== SCHEMA_VERSION) {
      throw new UnsupportedCollaborationSchemaError(
        Number.isSafeInteger(version) ? version : null,
        SCHEMA_VERSION,
        persistedVersion,
      );
    }

    this.assertCanonicalShape();
    const instanceId = readMetadata(this.database, "collaboration_instance_id");
    if (!instanceId) throw new Error("collaboration instance id is missing");
    return instanceId;
  }

  private legacyVersionForMigration(objects: SchemaObject[]): number | null {
    const hasMetadata = objects.some(
      (object) => object.type === "table" && object.name === "metadata",
    );
    if (!hasMetadata) return null;
    const persistedVersion = readMetadata(this.database, "schema_version");
    const version = persistedVersion == null ? Number.NaN : Number(persistedVersion);
    if (!Number.isSafeInteger(version) || !LEGACY_SCHEMA_VERSIONS.has(version)) {
      return null;
    }
    const actualNames = new Set(objects.map((object) => `${object.type}:${object.name}`));
    if (!sameSet(actualNames, legacySchemaObjectNames(version))) {
      throw new Error(`collaboration database structure does not match known schema ${version}`);
    }
    return version;
  }

  private dataVersion(): number {
    const row = this.database.prepare("PRAGMA data_version").get() as SqlRow | undefined;
    const value = row ? Object.values(row)[0] : undefined;
    if (typeof value !== "number" && typeof value !== "bigint") {
      throw new Error("SQLite did not return a data version for migration fencing");
    }
    return Number(value);
  }

  private backupLegacyDatabase(version: number): number {
    const dataVersion = this.dataVersion();
    if (this.databasePath === ":memory:") return dataVersion;
    const backupPath = `${this.databasePath}.schema-v${version}-backup.sqlite`;
    if (existsSync(backupPath)) {
      throw new Error(`legacy collaboration database backup already exists for schema ${version}`);
    }
    this.database.exec(`VACUUM INTO ${quoteSqlLiteral(backupPath)}`);
    chmodSync(backupPath, 0o600);
    return dataVersion;
  }

  private migrateLegacySchema(version: number): string {
    copyLegacyReceipts(this.database, version);
    rebuildTombstones(this.database);
    this.database.exec("DROP TABLE session_mutation_commands; DROP TABLE session_mutations;");
    if (version <= 13) {
      this.database.exec("DROP TABLE deletion_command_receipts; DROP TABLE command_receipt_conflicts;");
    }
    writeMetadata(this.database, "schema_version", String(SCHEMA_VERSION));
    writeMetadata(this.database, "schema_migrated_from", String(version));
    writeMetadata(this.database, "schema_migrated_at", String(nowMs()));
    this.assertCanonicalShape();
    const instanceId = readMetadata(this.database, "collaboration_instance_id");
    if (!instanceId) throw new Error("collaboration instance id is missing");
    return instanceId;
  }

  private assertCanonicalShape(): void {
    const expected = stableStringify(currentSchemaShape());
    const actual = stableStringify(readSchemaShape(this.database));
    if (actual !== expected) {
      throw new Error("collaboration database structure does not match the current schema");
    }
  }
}
