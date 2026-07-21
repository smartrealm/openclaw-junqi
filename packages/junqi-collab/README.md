# JunQi Collaboration Plugin

This package is the durable OpenClaw control plane behind JunQi collaboration
runs. It owns workflow state, dispatch idempotency, recovery, audit events, and
exact transcript delivery. JunQi is a client of the `junqi.collab.*` Gateway
RPC surface; it is not the workflow scheduler.

Current package baseline: plugin `0.3.0`, SQLite schema `12`, OpenClaw
`>=2026.7.1 <2027.0.0`.

## Execution boundary

The only execution path is:

```text
JunQi Chat
  -> junqi.collab.* Gateway RPC
  -> this plugin through public openclaw/plugin-sdk entry points
  -> Native runtime.subagent.run 或 ACP tools.invoke -> sessions_spawn(runtime="acp")
  -> runtime.tasks.runs lookup/cancel；ACP wait 使用 agent.wait
  -> exact session transcript append
```

Workers are Agents already configured in the connected OpenClaw Gateway and
allowed by both this plugin and the coordinator Agent. This package does not
spawn, discover, hook, or orchestrate independent local AI processes. Managed
Flows are Run-level mirrors only; Worker
execution never calls `managedFlows.runTask()`.

Requirements:

- Node.js `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0`
- OpenClaw `>=2026.7.1 <2027.0.0`
- A persistent Gateway runtime
- Explicit `coordinatorAgentId` and `allowedAgentIds` plugin configuration

Build and inspect locally:

```bash
npm run collab:build
npm run collab:pack
openclaw plugins install --force --pin npm-pack:packages/junqi-collab/dist/junqi-openclaw-collaboration-0.3.0.tgz
openclaw plugins inspect junqi-collab --runtime --json
```

Do not install a development build into a user's active OpenClaw profile for
tests. `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` alone are not a sufficient
isolation boundary: with OpenClaw 2026.7.1, `gateway run --dev` was observed
accessing default `~/.openclaw` despite both variables. Use a disposable
container/OS account, or independently isolate `HOME`, XDG directories, and
`TMPDIR`; use the final hash-verified tgz and do not use `--dev` or the default
workspace. A plugin load or capabilities call is only evidence for the exact
checks it exercises, not the complete real-Gateway acceptance matrix.
The capabilities response labels feature flags as a declared plugin contract
with `behaviorVerified: false`; it reports structural startup/integrity facts
but does not claim that Task recovery, cancellation, transcript idempotency, or
restart behavior has been exercised.

JunQi Desktop automatic bootstrap is stricter than the manual development
command. Every mutation is fenced to the exact verified target fingerprint and
connection id. Before replacement it must build a private offline tgz of the
installed plugin, journal archive/content-tree hashes and config ownership, and
fail before mutation when that backup is unavailable. Rollback has no registry
fallback. Health confirmation requires the embedded plugin version, schema 12,
`durableState`, both durable-runtime signals, and all required feature flags;
otherwise the journal remains `RecoveryRequired`.

## Persistence contract

The collaboration database and JSON export contain structured workflow data,
not Agent transcripts. Constructed Planner, Worker, and Synthesizer prompts are
built at dispatch time and are not stored as prompt fields in collaboration
SQLite or JSON exports. The dispatched message does enter the OpenClaw child
session, so its transcript follows OpenClaw's native retention policy and is
not deleted by collaboration retention or run deletion.

Planner and Worker responses are parsed into explicit field allowlists.
Unknown fields such as `prompt`, `reasoning`, `thinking`, `toolOutput`,
`rawOutput`, and `token` are discarded. Bounded structured execution data may
be stored internally in `attempts.input_json` and `work_item_inputs`; neither is
returned by run snapshots or JSON exports, and raw additional input is not
rendered in the UI. The domain-content deletion digest still covers both so a
delete preview is fenced against changes to all stored business content.
Each pending input id is copied into exactly the next WorkItem Attempt's
`input_json`; later retries do not consume it again.

Desktop capability observations allow only `targetFingerprint`,
`deploymentKind`, `persistence`, and `gatewayVersion`. Persisted configured
Agent facts contain id/name/description/runtime type/allow/coordinator flags,
coordinator and allowed-Agent ids, and runtime version. Configured Agent
`model` objects are removed before persistence and do not participate in the
capability config hash.

Attempts persist `worker_owner_session_key`, `child_session_key`, the OpenClaw
run id, and an optional resolved Task id. The public SDK path used here does not
expose a stable child session id or automatic mirrored-Flow id, so the plugin
does not persist or promise `workerSessionId` / `openclawMirroredFlowId`.
Attempt, WorkItem, and Delivery mutations use entity revisions so a stale UI
decision cannot overwrite a newer runtime result.

## Production architecture

The implementation applies explicit patterns at its failure boundaries:

- A Dispatcher Strategy isolates Native and ACP start protocols, response
  validation, and runtime-specific Task metadata. The adapter remains the
  single authority for exact Task lookup, recovery, cancellation, and result
  convergence.
- A pure Attempt recovery State Machine converts persistent Task observations
  into wait, settle, cancel, or intervention decisions. OpenClaw persistent
  Tasks, not `waitForRun()` hints or UI state, are the execution authority.
- A Durable Outbox stores domain changes and external effects atomically.
  `available_at` persists the next eligible claim time. A `FailureRetryPolicy`
  consumes only `failure_count`; infrastructure deferrals do not consume the
  business failure budget.
- Lease/CAS ownership is `command id + lease owner + attempts`. `attempts` is
  a monotonic lease-fencing generation, not the retry budget. Long effects
  renew their lease, and stale workers cannot commit results.
- PROVISION records `effect_started_at` under the claimed lease immediately
  before a possible create call. This is write-ahead evidence that the external
  effect may have started, not a success receipt.
- The Command Result Committer settles the exact claimed command before it
  applies Delivery, Cancellation, or Flow state in the same SQLite transaction.
- Nested Units of Work use SAVEPOINTs, so helpers can join an existing command
  transaction without opening another top-level transaction. Transaction
  callbacks are synchronous by type and runtime contract; any native Promise
  or custom `PromiseLike` is rejected before commit and rolled back.
- ProvisionExecutionPolicy separates `CREATE_OR_RECOVER`, `DEFER`, and
  `OBSERVE_ONLY`. Identity, provisioning, and closure Specifications validate
  exact controller/run/Flow identity, revision fences, state, terminal status,
  and cancellation intent.
- `RunDeletionRepository` is a read-only Query Repository. It supplies an
  indexed, cursor-stable broad retention candidate stream and a strict
  decision-fact snapshot from one read Unit of Work. It reads at most two
  stable Flow blocker witnesses, which represents zero, one, or at least two
  unresolved commands; it does not grant deletion authority.
- `RunDeletionPolicy` is a pure application policy with separate assessments
  for preview, explicit execution, retention, and retry recovery. A satisfied
  preview permits only preview issuance. The deletion worker re-reads the facts
  and re-evaluates the explicit policy inside its authoritative IMMEDIATE
  transaction before staging files or deleting rows.
- Delivery Specification is an immutable value object over exact target,
  artifact digest, target revision, attempt number, requirement, and effect key.
- BackgroundLifecycleSupervisor owns keyed tasks, timers, AbortSignal, error
  observation, runtime races, and shutdown drain.

## Storage shape

The current physical database is schema 12. Its tables are:

```text
metadata
collaboration_runs, plan_revisions, work_items, attempts
evidence, interventions, final_artifacts
deliveries, delivery_attempts
commands, collaboration_events, decisions, work_item_inputs
export_jobs, deletion_jobs, deletion_command_receipts, command_receipts
command_receipt_conflicts
session_mutations, session_mutation_commands
tombstones
```

The schema has explicit indexes for active-origin uniqueness, immutable run
history, run session/status lookup, WorkItem status, active Attempts, open
Interventions, pending/delayed commands, per-run event sequence,
deletion/unified command receipts, active and unresolved session-mutation
fences, mutation commands, tombstones ordered by deletion time, and deletion
policy lookups by terminal `ended_at + id`, Run-scoped active Attempt/command,
failed Flow command, export status, and deletion-job status. The v7
migration added `commands_available(status, available_at, lease_expires_at, created_at)`;
v8 added `commands.failure_count`; v9 added `commands.effect_started_at`; v10 added the Flow reconciliation
abandonment evidence fields to tombstones; v11 added the nullable authoritative
`deletion_job_id` used to fence recovery to one exact deletion job; v12 added
`attempts.execution_runtime`, backfilled from the captured capability snapshot or
an existing ACP child-session identity. `tombstones`
includes `cleanup_status`, `cleanup_error`, `cleanup_updated_at`, and nullable
`deletion_job_id`,
`flow_reconciliation_command_id`, `openclaw_flow_id`,
`openclaw_flow_revision`, `flow_reconciliation_diagnostic`,
`flow_reconciliation_abandoned_at`, and
`flow_reconciliation_abandon_reason`; `command_receipts` preserves bounded idempotent replay
after a Run is cascade-deleted, while `command_receipt_conflicts` quarantines
legacy command-id namespace/hash collisions found during the v6 migration. There
are no physical `approvals`, `capability_snapshots`, `workboard_mirrors`, or
attachment tables.

The command outbox uses these actual states:

```text
PENDING -> LEASED -> SUCCEEDED | FAILED | UNKNOWN | CANCELLED
```

Expired leases return to `PENDING`. `FAILED` is a known failure and is not
automatically reclaimed. `UNKNOWN` blocks blind replay until reconciliation or
an explicit resolution.

PROVISION and FLOW_SYNC use separate bounded failure policies. PROVISION permits
three business failures with 1s/5s backoff; FLOW_SYNC permits five with
1s/5s/30s/120s backoff. Claim/reclaim changes `attempts`, known business failure
changes `failure_count`, and a maintenance/session deferral changes
`available_at` without consuming failure budget. When failures are exhausted,
the command becomes `FAILED` and the Run exposes `RECONCILE`. An operator retry
reopens the same command/effect, clears only `failure_count`, and preserves the
lease generation plus `effect_started_at` evidence.

Receipts are created only for externally submitted write commands, not for
controller-generated dispatch/watch/reconcile commands. `command_receipts.source`
is bound to the concrete RPC or stable operation (`junqi.collab.*`, `RUN:*`,
`WORK_ITEM:*`, `DELIVERY:*`, or `SESSION_MUTATION:*`), so replay requires the
same command id, source, and payload hash. Normal Run-scoped commands are
bounded at 4,096 receipts. After that boundary, 64 additional slots remain
available only to the terminal recovery operations that stop dispatch, cancel
a Run or WorkItem, abandon delivery, or delete/retry deletion. The physical
per-Run ceiling is therefore 4,160 receipts and remains bounded even on the
recovery path. Maintenance/session operations have a separate 10,000-receipt
unscoped limit. Capacity is checked before the corresponding write effect
commits.

`junqi.collab.run.clone` validates the caller's original write envelope once;
it does not add inherited fields and then recompute or revalidate the payload
hash. The receipt source is exactly `junqi.collab.run.clone`. A successful
clone returns `sourceRunId` and appends `RUN_CLONED` with the same source id to
the new Run, while still creating a fresh Run, capability snapshot, planning
Attempt, and approval chain.

Maintenance and session-mutation responses persisted in receipts use the
minimal active-Run reference only. They include identity/status/revision fields
needed for recovery, but not the Run goal, plan content, capability snapshot,
Evidence, or transcript.

Legacy command ids reused across namespaces or with conflicting payload hashes
are recorded in `command_receipt_conflicts`. Only those ids are quarantined
with `IDEMPOTENCY_CONFLICT`; schema migration and database startup continue.

## Runtime closure and race ownership

- PROVISION first performs an exact owner-session/controller lookup. The
  anti-corruption boundary returns only `FOUND`, `ABSENT`, or `AMBIGUOUS`;
  ambiguity fails closed, and a newly created Flow must be observable in the
  owner registry under the same controller. Only an unfenced `PROVISIONING` Run
  may create or recover. `CANCELLING`, `COMPLETED`, `CANCELLED`, and `FAILED`
  Runs are observe-only and can never create a replacement Flow.
- Provisioning accepts only an exact running Flow without cancellation intent.
  Terminal closure maps COMPLETED/CANCELLED/FAILED to
  succeeded/cancelled/failed and permits only the persisted provision revision
  through the current Run revision. A verified controller/revision/status
  conflict persists the observed Flow reference, fails the command, creates an
  Intervention, sets reconciliation to `ATTENTION_REQUIRED`, and exposes
  `RECONCILE` instead of overwriting remote state.
- A lost/thrown `runtime.subagent.run()` response marks the same command and
  Attempt `UNKNOWN`, stops dispatch, and preserves the existing effect and
  idempotency keys. Reconcile binds `runtime.tasks.runs` to the worker owner
  session and matches the exact deterministic child session key. One Task
  match recovers its original task/run ids; zero or multiple matches remain
  `UNKNOWN`. Once an Attempt is `UNKNOWN`, the plugin never calls
  `runtime.subagent.run()` for it again and never creates a replacement Attempt.
- ACP Agents use the same durable Attempt boundary through the official
  Gateway `tools.invoke -> sessions_spawn(runtime="acp")` path. The adapter
  persists the returned ACP child session key and uses a deterministic label
  for response-loss reconciliation; it never replays `tools.invoke` blindly.
  Missing or ambiguous ACP Task evidence remains `UNKNOWN` and requires
  operator reconciliation.
- `cancel_requested_at` is sticky. Watchers re-read Attempt/Run state after
  awaited runtime calls, and terminal outcomes commit with status/revision CAS.
  Completion, timeout, and cancellation can therefore leave only one terminal
  outcome and one consistent Evidence set. Timeout requests real Task
  cancellation first; an unconfirmed/throwing result remains `UNKNOWN` rather
  than claiming `TIMED_OUT`.
- Timeout detection and its `CANCEL_ATTEMPT` command are committed together.
  The payload carries `terminalReason=TIMEOUT`, so restart recovery does not
  depend on a process timer. `TIMED_OUT` is committed only after exact Task
  cancellation is confirmed.
- Work-item cancellation stops new dispatch, writes durable Decision/Event/
  Intervention evidence, and cancels the real OpenClaw Task. It does not claim
  terminal closure from a UI-only state change.
- UNKNOWN resolution requires the exact Attempt revision. A `RUNNING`
  resolution under sticky cancellation queues cancellation again; a terminal
  resolution continues pending partial/cancellation closure.
- Partial preview/accept is valid only in `AWAITING_INTERVENTION` without sticky
  cancellation. Run cancellation changes a pending decision to
  `PARTIAL_SUPERSEDED`, so it cannot later waive work or start synthesis.
- A `SENDING` Delivery and its `SUBMITTING` DeliveryAttempt exclusively own the
  transcript append. Retry, retarget, and abandon cannot cross that fence;
  `DELIVERY_PENDING` rejects ordinary Run cancel and requires explicit idle
  Delivery abandonment. A result commits only against the exact Delivery revision/effect key.
  Retarget atomically abandons the latest idle uncertain target before creating
  its successor.
- A thrown transcript append has an unknown outcome. Recovery reuses the same
  immutable target/artifact tuple and the original DeliveryAttempt effect key.
  OpenClaw's public append helper performs a persistent create-or-get inside the
  transcript write transaction and returns the existing message id after a
  response-loss replay. Only a known `RETRY_REQUIRED` failure may create a new
  DeliveryAttempt/key; an uncertain replay that is not confirmed stays `UNKNOWN`.
- Managed Flow cancellation is two phase. `requestCancel(expectedRevision)`
  persists `cancelRequestedAt` and advances the Flow revision; `cancel()` performs
  the terminal operation. If the second phase fails, retry with the original
  expected revision recognizes the persisted request and does not issue it again.
  Success requires `found`, `cancelled`, and a returned Flow status of `cancelled`.
- Session reset/delete establishes a durable PREPARED mutation fence before the
  core RPC. The fence blocks plan creation, dispatch resume, and queued work;
  EXPIRED remains unresolved until explicit recovery records the core result.
- A terminal FLOW_SYNC failure and an exhausted PROVISION retry expose the
  operator `RECONCILE` action. The same command/effect is reopened, preserving
  the external object identity and full audit trail.
- A Run terminal transition and its FLOW_SYNC command commit in the same
  SQLite transaction. Startup repair scans terminal Runs and atomically inserts
  only a missing matching command, closing legacy/interruption windows without
  duplicating an existing effect.

## History and maintenance

`junqi.collab.run.list` cursor v2 is opaque, canonical, at most 512 decoded
bytes, filter-bound, and ordered by immutable `(created_at, id)`. Its first page
fixes a snapshot upper bound. Clients load all pages before sorting the aggregate
by `updatedAt DESC, runId DESC`, so a Run updated between pages is neither
skipped nor duplicated.

Controller safety work does not use the 500-row UI page as a total. Maintenance
and reconcile scan active Runs by immutable id until exhaustion. Maintenance
responses remain bounded to at most 100 minimal references and a 64 KiB internal
budget, while `activeRunCount` and `activeRunsTruncated` disclose the complete
count and response truncation separately.

The Desktop projection is connection-scoped. It renders collaboration data only
when the Gateway is connected, RuntimeIdentity is verified, connection id equals
the projection connection id, and runtime id equals the collaboration instance
id. Disconnect, instance replacement, and reset advance a projection epoch and
invalidate polling plus in-flight session/event/tombstone requests, so a late
response from an old connection cannot repopulate the current UI. Event cursor
invalidation, pruned history, or a client page limit remains visible as an
incomplete timeline with a reason; the latest Run snapshot stays authoritative.

Business content is never silently truncated. Normal bounded business writes
fail with `CAPACITY_EXCEEDED` before their write transaction commits. Export is
the deliberate asynchronous exception: `export.create` first persists and
accepts a `PENDING` job/command, then the worker performs capacity and file
checks. The primary limits are:

| Data | Hard limit |
| --- | ---: |
| Goal or plan revision instruction | 32 KiB each |
| Complete plan or Worker result | 512 KiB each |
| Work items | 64 per plan |
| Evidence | 64 items per Worker attempt |
| Additional input | 32 KiB each, 32 items and 256 KiB per WorkItem |
| Final artifact | 256 KiB |
| Planner/Worker/Synthesizer attempts | 32 per entity and kind |
| Plan revisions | 32 per run |
| Normal Run-scoped command receipts | 4,096 per Run |
| Terminal-recovery receipt reserve | 64 additional per Run; 4,160 physical total |
| Unscoped command receipts | 10,000 total |
| Export event stream | 10,000 events |
| Export materialization preflight | 64 MiB conservative budget |
| Export JSON file | 16 MiB total |

An export that exceeds any of these limits, loses its requested revision
fence, or fails file verification ends as `export_jobs.status=FAILED` with a
bounded diagnostic; temporary files are removed. Acceptance is therefore not
completion, and the package does not promise that every terminal Run can be
exported unconditionally. V1 has no summary or split-export fallback.

Exports include the capability snapshot, every plan revision, safe WorkItem and
Attempt projections, Evidence, Interventions, Decisions, FinalArtifact,
Deliveries and DeliveryAttempts, command audit metadata, and the event stream.
They exclude constructed prompts, `attempts.input_json`, raw
`work_item_inputs`, command `payload_json`, full child transcripts, chain of
thought, and raw tool output. The only plugin-managed files are JSON artifacts
under `exports/`; V1 has no attachment lifecycle or Workboard mirror.

Origin and external runtime identifiers have field-specific limits between
256 bytes and 2 KiB. Credential-shaped content (Bearer values, assigned
tokens/API keys/passwords/secrets, private keys, and common credential
prefixes) is rejected in persistable business fields. Runtime diagnostics are
the only content that may be shortened: secrets are redacted, and diagnostics
over 4 KiB are replaced by an omission marker plus a SHA-256 digest.

The authoritative values and validators live in
`src/persistence-policy.ts`.

`retentionDays` is enforced by the controller at startup and every six hours.
Only terminal runs whose `ended_at` is older than the configured threshold are
eligible. Runs with active/unknown attempts, pending/leased/unknown commands,
non-IDLE reconciliation, any FLOW_SYNC not already `SUCCEEDED/CANCELLED`, a
failed PROVISION, pending exports, or unresolved deletion jobs are retained.
Candidate selection is intentionally broader than those rules: a stable
`ended_at + id` cursor advances until the ordered scan is exhausted, and a
page/time-budget stop schedules a near-term continuation instead of restarting
at the first permanently blocked Run. The application policy is re-evaluated
from strict persisted facts before deletion. It has no abandonment input and
therefore no authority to abandon Flow reconciliation. Cleanup removes
plugin-managed export files and the run's cascading workflow rows, while
keeping a SHA-256 tombstone. User-initiated deletion records actor `operator`;
retention records `retention-policy`. The public plugin SDK does not provide a
verified human principal, so `operator` must not be presented as a specific
user identity.

Run-scoped unified and deletion receipts survive the cascade delete only for
the `retentionDays` replay window. Once the tombstone is older than that window
and its cleanup is `COMPLETED`, the sweep removes those receipts and keeps the
tombstone. Unscoped receipts use the same age limit, except receipts tied to an
unresolved `PREPARED` or `EXPIRED` session mutation remain until resolution.

The `junqi-collaboration-content/v3` digest is computed incrementally in a read
transaction. It covers `collaboration_runs`, `plan_revisions`, `work_items`,
`attempts` (including structured `input_json`), `evidence`, `interventions`,
`final_artifacts`, `deliveries`, `delivery_attempts`, `collaboration_events`,
`decisions`, and raw `work_item_inputs`. It excludes `metadata`, `commands`,
export/deletion jobs, deletion/unified/conflict command receipt tables, both
session mutation tables, and tombstones. This is a versioned domain-content deletion
guard, not a whole-database hash or export digest, and is independent of the
user-facing export limits.

Logical deletion and tombstone creation commit before managed JSON cleanup.
Tombstone cleanup is `PENDING`, `PARTIAL`, or `COMPLETED`; `PARTIAL` means the
Run rows are already gone but one or more managed export/staging paths still
need cleanup. Recovery retries only that physical cleanup and must never make
the Run visible again. `junqi.collab.tombstone.list` exposes the newest records
in deletion order (default 100, maximum 500), and the Chat history drawer loads
the newest 500 with cleanup diagnostics but no deleted business content.

A user-requested delete with a failed PROVISION/FLOW_SYNC requires an explicit
exception path. `run.delete.preview` returns a structured blocker containing
the command id/status, Flow id/revision, and bounded diagnostic, and binds this
evidence together with the Run revision and content digest into its expiring
confirmation token. The UI requires three gates: obtain the server preview;
enter a non-empty reason and separately confirm permanent Flow-reconciliation
abandonment; then confirm permanent Run deletion. The service recomputes the
blocker in the delete transaction and otherwise returns
`FLOW_RECONCILIATION_REQUIRED`. A blocker change invalidates the token. If at
least two failed Flow commands exist, preview, execution, and retry all fail
closed; the current single-evidence tombstone cannot authorize or represent an
arbitrary subset.

The resulting tombstone preserves the exact command/Flow/revision/diagnostic,
abandonment timestamp, and reason. The Desktop decoder rejects a partial
evidence group and the history drawer renders complete evidence. Its error-code
allowlist preserves `FLOW_RECONCILIATION_REQUIRED`; a pure preview-recovery
policy invalidates and refreshes a DELETE preview after that error, and
invalidates DELETE/PARTIAL previews after `REVISION_CONFLICT`. Destructive
commands are never replayed automatically.

Collaboration cleanup never deletes OpenClaw child transcripts, Tasks, Flows,
or JunQi Chat history. Workboard is also not implemented in V1; capabilities
report it as unsupported.

## Verification snapshot

The 2026-07-18 finalization audit ran the canonical plugin suite successfully:
364/364 tests passed, and the plugin TypeScript build passed. This count is an
audit snapshot rather than a compatibility promise;
the repository scripts and release record remain the source of truth for each
subsequent build. Real OpenClaw Gateway acceptance, browser visual QA, and
long-running soak tests are separate release gates and are not claimed by this
package-level result.

The archive SHA-256, two-build reproducibility, generated/Tauri metadata parity,
and packed-consumer result are recorded outside the archive in the repository
release audit. This packaged README intentionally cannot embed its own archive
digest because doing so would make the digest self-referential.
