import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
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

export class CollaborationSchemaInitializer {
  constructor(private readonly database: DatabaseSync) {}

  initialize(): string {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const objects = schemaObjects(this.database);
      const instanceId = objects.length === 0
        ? this.createCurrentSchema()
        : this.verifyCurrentSchema(objects);
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
      throw new Error(
        `database schema ${persistedVersion ?? "missing"} is unsupported; expected ${SCHEMA_VERSION}`,
      );
    }

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
