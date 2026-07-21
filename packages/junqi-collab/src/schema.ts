export const SCHEMA_VERSION = 12;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collaboration_runs (
  id TEXT PRIMARY KEY,
  origin_runtime_id TEXT NOT NULL,
  origin_agent_id TEXT NOT NULL,
  origin_session_key TEXT NOT NULL,
  origin_session_id TEXT NOT NULL,
  origin_native_message_id TEXT NOT NULL,
  origin_client_message_id TEXT,
  origin_channel TEXT,
  origin_account_id TEXT,
  origin_target TEXT,
  origin_thread_id TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  resume_status TEXT,
  dispatch_state TEXT NOT NULL,
  archive_state TEXT NOT NULL DEFAULT 'ACTIVE',
  reconcile_state TEXT NOT NULL DEFAULT 'IDLE',
  completion_outcome TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  current_plan_revision_id TEXT,
  openclaw_flow_id TEXT,
  openclaw_flow_revision INTEGER,
  capability_snapshot_json TEXT NOT NULL,
  capability_config_hash TEXT,
  cancel_requested_at INTEGER,
  failure_code TEXT,
  failure_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS collaboration_runs_active_origin
ON collaboration_runs(origin_runtime_id, origin_agent_id, origin_session_key, origin_session_id)
WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');

CREATE INDEX IF NOT EXISTS collaboration_runs_session
ON collaboration_runs(origin_session_key, origin_session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS collaboration_runs_status
ON collaboration_runs(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS collaboration_runs_history
ON collaboration_runs(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS collaboration_runs_retention
ON collaboration_runs(ended_at, id)
WHERE status IN ('COMPLETED', 'CANCELLED', 'FAILED') AND ended_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS plan_revisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  source_attempt_id TEXT,
  approved_at INTEGER,
  approved_by TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(run_id, revision_no)
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  plan_revision_id TEXT NOT NULL REFERENCES plan_revisions(id) ON DELETE RESTRICT,
  logical_id TEXT NOT NULL,
  title TEXT NOT NULL,
  input_scope_json TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  required_capabilities_json TEXT NOT NULL,
  candidate_agent_ids_json TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  side_effect_class TEXT NOT NULL,
  assigned_agent_id TEXT,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, plan_revision_id, logical_id)
);

CREATE INDEX IF NOT EXISTS work_items_run_status
ON work_items(run_id, status, updated_at);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  worker_agent_id TEXT NOT NULL,
  execution_runtime TEXT NOT NULL DEFAULT 'native'
    CHECK(execution_runtime IN ('native', 'acp')),
  worker_owner_session_key TEXT NOT NULL,
  child_session_key TEXT NOT NULL,
  openclaw_run_id TEXT,
  openclaw_task_id TEXT,
  status TEXT NOT NULL,
  outcome_json TEXT,
  input_json TEXT NOT NULL,
  last_error TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER,
  ended_at INTEGER,
  last_reconciled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, work_item_id, kind, attempt_no)
);

CREATE INDEX IF NOT EXISTS attempts_active
ON attempts(status, updated_at)
WHERE status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN');

CREATE INDEX IF NOT EXISTS attempts_run_active
ON attempts(run_id, status)
WHERE status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN');

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  reference TEXT NOT NULL,
  verification TEXT NOT NULL,
  warning TEXT,
  digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  required_action TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL,
  resume_status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  resolution_json TEXT
);

CREATE INDEX IF NOT EXISTS interventions_open
ON interventions(run_id, resolved_at, created_at);

CREATE TABLE IF NOT EXISTS final_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  source_attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE RESTRICT,
  content TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  final_artifact_id TEXT NOT NULL REFERENCES final_artifacts(id) ON DELETE RESTRICT,
  target_revision INTEGER NOT NULL,
  requirement TEXT NOT NULL,
  status TEXT NOT NULL,
  transcript_status TEXT NOT NULL,
  channel_status TEXT NOT NULL,
  target_json TEXT NOT NULL,
  message_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, target_revision)
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  receipt_json TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(delivery_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  entity_id TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  effect_started_at INTEGER,
  available_at INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  response_json TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS commands_pending
ON commands(status, lease_expires_at, created_at);

CREATE INDEX IF NOT EXISTS commands_run_active
ON commands(run_id, status, kind, id)
WHERE status IN ('PENDING', 'LEASED', 'UNKNOWN');

CREATE INDEX IF NOT EXISTS commands_run_failed_flow
ON commands(run_id, kind, created_at DESC, id DESC)
WHERE status = 'FAILED' AND kind IN ('PROVISION', 'FLOW_SYNC');

CREATE TABLE IF NOT EXISTS collaboration_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  run_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS collaboration_events_run_sequence
ON collaboration_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_item_inputs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  format TEXT NOT NULL,
  artifact_path TEXT,
  digest TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS export_jobs_run_status
ON export_jobs(run_id, status);

CREATE TABLE IF NOT EXISTS deletion_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  confirmation_digest TEXT NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS deletion_jobs_run_status
ON deletion_jobs(run_id, status);

CREATE TABLE IF NOT EXISTS deletion_command_receipts (
  command_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  deletion_job_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS deletion_command_receipts_run
ON deletion_command_receipts(run_id, created_at);

CREATE TABLE IF NOT EXISTS command_receipts (
  command_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  run_id TEXT,
  payload_hash TEXT NOT NULL,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS command_receipts_run
ON command_receipts(run_id, created_at);

CREATE TABLE IF NOT EXISTS command_receipt_conflicts (
  command_id TEXT PRIMARY KEY,
  diagnostic TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_mutations (
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

CREATE UNIQUE INDEX IF NOT EXISTS session_mutations_active
ON session_mutations(runtime_id, session_key, session_id)
WHERE status = 'PREPARED';

-- EXPIRED means the Desktop disappeared before recording the core RPC result.
-- It remains an unresolved fence until an explicit recovery completion.
CREATE UNIQUE INDEX IF NOT EXISTS session_mutations_unresolved
ON session_mutations(runtime_id, session_key, session_id)
WHERE status IN ('PREPARED', 'EXPIRED');

CREATE TABLE IF NOT EXISTS session_mutation_commands (
  command_id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL REFERENCES session_mutations(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS session_mutation_commands_mutation
ON session_mutation_commands(mutation_id, created_at);

CREATE TABLE IF NOT EXISTS tombstones (
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

CREATE INDEX IF NOT EXISTS tombstones_deleted_at
ON tombstones(deleted_at DESC, id DESC);
`;
