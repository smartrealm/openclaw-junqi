import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

export function createLegacySchema(filePath: string, version: 12 | 13 | 14): void {
  const raw = new DatabaseSync(filePath);
  try {
    raw.exec(SCHEMA_SQL);
    if (version <= 13) raw.exec("DROP INDEX commands_available;");
    raw.exec("DROP TABLE tombstones;");
    raw.exec(`
      CREATE TABLE tombstones (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        actor TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        deletion_job_id TEXT,
        deleted_at INTEGER NOT NULL,
        cleanup_status TEXT NOT NULL DEFAULT 'COMPLETED',
        cleanup_error TEXT,
        cleanup_updated_at INTEGER NOT NULL DEFAULT 0,
        flow_reconciliation_command_id TEXT,
        openclaw_flow_id TEXT,
        openclaw_flow_revision INTEGER,
        flow_reconciliation_diagnostic TEXT,
        flow_reconciliation_abandoned_at INTEGER,
        flow_reconciliation_abandon_reason TEXT
      );
      CREATE INDEX tombstones_deleted_at ON tombstones(deleted_at DESC, id DESC);
      CREATE TABLE session_mutations (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        policy TEXT NOT NULL,
        status TEXT NOT NULL,
        lease_expires_at INTEGER NOT NULL,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX session_mutations_active
      ON session_mutations(runtime_id, session_key, session_id)
      WHERE status = 'PREPARED';
      CREATE UNIQUE INDEX session_mutations_unresolved
      ON session_mutations(runtime_id, session_key, session_id)
      WHERE status IN ('PREPARED', 'EXPIRED');
      CREATE TABLE session_mutation_commands (
        command_id TEXT PRIMARY KEY,
        mutation_id TEXT NOT NULL REFERENCES session_mutations(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX session_mutation_commands_mutation
      ON session_mutation_commands(mutation_id, created_at);
    `);
    if (version <= 13) {
      raw.exec(`
        CREATE TABLE deletion_command_receipts (
          command_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          deletion_job_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX deletion_command_receipts_run
        ON deletion_command_receipts(run_id, created_at);
        CREATE TABLE command_receipt_conflicts (
          command_id TEXT PRIMARY KEY,
          diagnostic TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    }
    if (version === 12) {
      raw.exec(`
        DROP TABLE workflow_run_templates;
        DROP TABLE workflow_template_versions;
        DROP TABLE workflow_templates;
      `);
    }
    raw.prepare(
      "INSERT INTO metadata(key, value, updated_at) VALUES ('schema_version', ?, 1)",
    ).run(String(version));
    raw.prepare(
      "INSERT INTO metadata(key, value, updated_at) VALUES ('collaboration_instance_id', 'instance_legacy', 1)",
    ).run();
  } finally {
    raw.close();
  }
}
