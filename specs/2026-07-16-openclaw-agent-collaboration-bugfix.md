# OpenClaw Agent Collaboration Finalization Spec

Date: 2026-07-16; updated 2026-07-18

Current baseline: JunQi Collaboration Plugin `0.3.0`, SQLite schema `11`, OpenClaw `2026.7.1`.

## Runtime boundary

This campaign implements an OpenClaw Agent workflow. The only execution chain is JunQi -> `junqi.collab.*` -> public OpenClaw Plugin SDK -> `runtime.subagent.run`/`runtime.tasks.runs`/session transcript APIs. Workers are configured and authorized OpenClaw Agents.

## BUG-01 - Durable deletion cleanup

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** tombstones distinguish `PENDING`, `PARTIAL`, and `COMPLETED` cleanup. Recovery commits durable state around disk cleanup, records bounded errors, and retries after the Run row is gone.

**Acceptance:**

- [x] A simulated post-commit interruption is recovered after reopening the database.
- [x] Failed physical cleanup cannot be represented as a clean tombstone.
- [x] Recovery can complete cleanup without the deleted Run row.

## BUG-02 - Durable export completion

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** the artifact and parent directory are synced before job completion; `export.get` validates artifact existence, size, and digest and records failure durably.

**Acceptance:**

- [x] A valid completed export remains downloadable.
- [x] A missing or invalid artifact changes the job to `FAILED` with a bounded diagnostic.

## BUG-03 - Bundled source parity

**Status:** RESOLVED WITH REPRODUCIBLE BUNDLE

**Target:** final source, archive, generated metadata, and Tauri resource metadata agree after the last source change.

**Acceptance:**

- [x] Current-source bundle metadata and Tauri resource agree on SHA-256 `bea9b0ac8640694495fc8980c4d418fca5bc3b67f4edfc8509c28b8dd035e016`.
- [x] Bundle validation passes and both metadata files are byte-identical, report plugin `0.3.0` / schema `11`, reference the same archive, and contain exactly 151 allowlisted files.

## BUG-04 - Export temporary-file recovery

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** a leased export reclaims only sufficiently old temporary files for the same job/known orphan pattern.

**Acceptance:**

- [x] Old same-job and known orphan temp files are removed.
- [x] Recent/live-writer and other-job files are preserved.

## BUG-05 - Documentation fidelity

**Status:** RESOLVED FOR CURRENT SOURCE SNAPSHOT

**Implemented:** OpenClaw-only execution boundary, physical schema, state transitions, work-item controls, UNKNOWN/partial/cancel/delivery races, stable history, bootstrap recovery, capacity contracts, and validation status match source.

**Acceptance:**

- [x] The documents describe only the OpenClaw Agent execution boundary.
- [x] No obsolete schema/test-count, mutable-cursor, fixed-500-scan, or incomplete bootstrap-health claim remains.
- [x] Future and unverified gates are visibly marked as such.

## BUG-06 - Boundary and restart regression evidence

**Status:** RESOLVED FOR SOURCE AUTOMATION

**Implemented:** focused tests cover schema migration, restart/replay, dispatch uncertainty, state races, history mutation, active-run scale, export/deletion recovery, identifiers, work-item limits, clone provenance, and bounded receipt recovery.

**Acceptance:**

- [x] Focused regressions exercise the previously missing behavior.
- [x] Canonical plugin suite passes: 356/356 tests on 2026-07-19.
- [x] The repository-wide automated matrix was rerun after the current bundle hardening: Desktop 765/765, evidence and Gateway scripts 192/192, lint/build, Rust fmt/check/clippy, and Rust 282 passed / 2 environment-mutating tests intentionally ignored. Historical acceptance notes earlier in this specification remain superseded by the current audit snapshot.

## BUG-07 - Product-visible deletion audit

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** a bounded read RPC and Collaboration history UI expose Run id, actor, digest, deletion time, and cleanup status without deleted business content.

**Acceptance:**

- [x] Tombstone RPC requires `operator.read`, defaults to 100, and caps the limit at 500.
- [x] Collaboration history automated coverage renders deleted records and pending-cleanup state.
- [ ] Browser visual and interaction QA confirms final desktop/mobile rendering.

## BUG-08 - Clone envelope and provenance

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** `run.clone` validates the original caller envelope once, resolves inherited goal/origin separately, and binds receipts to `junqi.collab.run.clone`.

**Acceptance:**

- [x] A normal clone request passes its original payload hash unchanged.
- [x] Response/replay and `RUN_CLONED` include the same `sourceRunId`.
- [x] Reusing the command id under another operation returns `IDEMPOTENCY_CONFLICT`.

## BUG-09 - Bounded terminal-recovery receipt reserve

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** normal Run-scoped commands stop at 4,096 receipts. Terminal recovery operations alone can use 64 additional entries, keeping the physical total bounded at 4,160.

**Acceptance:**

- [x] Normal overflow is rejected before effects at 4,096.
- [x] Terminal recovery remains available through the 64-entry reserve.
- [x] The 4,161st physical receipt is rejected deterministically.

## BUG-10 - Exact bootstrap trust boundary

**Status:** RESOLVED IN SOURCE AUTOMATION; REAL TARGET RECOVERY GATE OPEN

**Implemented:** apply/configure/restart/recover/abandon/health operations require exact target and connection fences. Apply requires a private exact offline tgz backup with archive and content-tree hashes and records config ownership. Rollback has no registry fallback and verifies restored tree/version/enable/config. Health requires the embedded plugin version/schema, `durableState`, both durable-runtime signals, and all required features.

**Acceptance:**

- [x] Managed Child/unknown/non-owned targets fail closed before automatic mutation.
- [x] Missing or invalid exact backup fails before plugin/config mutation.
- [x] Rollback uses only the hash-verified offline artifact and detects external config changes.
- [x] Health mismatch persists `RecoveryRequired`.
- [ ] Real System Service and persistent Docker recovery drills pass on isolated targets.

## BUG-11 - Uncertain Subagent dispatch

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** a thrown/lost `runtime.subagent.run()` response marks the same Attempt and command `UNKNOWN`, stops dispatch, and creates an Intervention carrying the existing idempotency key. Reconciliation is forbidden from creating a replacement Attempt.

**Acceptance:**

- [x] Recovery reuses the same Attempt and idempotency key.
- [x] A remote identity returned after sticky cancellation is captured and then cancelled.
- [x] Dependencies do not advance while the Attempt remains UNKNOWN.

## BUG-12 - Attempt terminal race

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** watcher, completion, timeout, and cancellation paths re-read after awaits and use exact Attempt status/revision CAS. Evidence and downstream transitions occur only in the winning terminal transaction.

**Acceptance:**

- [x] Cancellation winning before transcript parse prevents later success/Evidence.
- [x] A committed success is not overwritten by a later cancellation result.
- [x] A deferred timeout cannot overwrite a completion that commits first.
- [x] Timeout becomes `TIMED_OUT` only after confirmed remote cancellation; otherwise the Attempt remains `UNKNOWN`.
- [x] Exactly one terminal Attempt outcome is retained.

## BUG-13 - Partial/cancel ordering

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** partial preview/accept requires `AWAITING_INTERVENTION`, exact revision/token, no sticky cancellation, and settled affected Attempts. Run cancellation changes pending partial to `PARTIAL_SUPERSEDED` before terminal closure.

**Acceptance:**

- [x] Partial remains pending while real Attempt cancellation is unconfirmed.
- [x] Run cancellation cannot be followed by WAIVED nodes or synthesis from the stale partial decision.
- [x] Terminal Run state cannot reopen through partial completion.

## BUG-14 - Delivery submission ownership

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** only the exact `SENDING` Delivery revision and its `SUBMITTING` DeliveryAttempt can commit append results. Retry/retarget/abandon are fenced while submission is active; `DELIVERY_PENDING` rejects ordinary Run cancel and requires explicit idle Delivery abandonment. Retarget atomically abandons the latest idle uncertain Delivery before creating a successor.

**Acceptance:**

- [x] Conflicting user commands fail while append is in flight.
- [x] A late result cannot complete an abandoned or superseded Delivery.
- [x] Retarget leaves exactly one latest target eligible for delivery.

## BUG-15 - Work-item operator closure and UNKNOWN resolution

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** input/cancel/retry/reassign operations require exact WorkItem revision. Supplemental input ids are bound once to the next Attempt and raw content remains internal. Work-item cancellation stops dispatch, records Decision/Event/Intervention, and cancels the real OpenClaw Task. UNKNOWN resolution requires exact Attempt revision and rejoins pending partial/cancel state.

**Acceptance:**

- [x] Stale entity writes fail with `REVISION_CONFLICT`.
- [x] Supplemental input appears in exactly the next Attempt, not subsequent retries, snapshots, or exports.
- [x] Work-item cancellation does not report settled while the runtime Task is unconfirmed.
- [x] `RUNNING` resolution under sticky cancellation queues cancellation again; terminal resolution closes settled cancellation/partial work.

## BUG-16 - Stable history and exhaustive active-run scans

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** cursor v2 is canonical, filter-bound, at most 512 decoded bytes, uses immutable `created_at + id`, and carries a first-page snapshot upper bound. Frontend aggregation precedes `updatedAt DESC, runId DESC` sorting. Maintenance/reconcile safety scans page by immutable id until exhaustion; returned references remain bounded and disclose truncation/count separately.

**Acceptance:**

- [x] Updating a Run between history pages does not skip or duplicate it.
- [x] Cursor filter changes and malformed/non-canonical cursors fail closed.
- [x] Maintenance/reconciliation sees active Run 501.
- [x] Response payload returns at most 100/64 KiB references plus authoritative `activeRunCount` and `activeRunsTruncated`.

## BUG-17 - Cross-restart dispatch identity recovery

**Status:** RESOLVED IN SOURCE AUTOMATION; REAL GATEWAY RESTART GATE OPEN

**Previous:** an Attempt whose `runtime.subagent.run()` acknowledgement was lost became `UNKNOWN`, but reconciliation could requeue its original command and call `run()` again. A process-local idempotency map is not a restart-safe authority.

**Implemented:** public-SDK Task lookup binds to persisted runtime, worker owner session, deterministic child session, run id, and optional exact task id. One exact match captures the original identity; zero, multiple, lost, or mismatched results remain `UNKNOWN`. An `UNKNOWN` Attempt is never passed to `runtime.subagent.run()` again.

**Acceptance:**

- [x] A response-lost Agent start is recovered from a persisted exact Task after recreating the runtime/service.
- [x] The recreated runtime has an empty process idempotency cache and records zero additional `runAgent()` calls.
- [x] An absent or ambiguous lookup leaves the Attempt and original command `UNKNOWN` and dispatch closed.
- [x] Sticky Run/WorkItem cancellation captures the recovered identity and cancels the exact Task.

## BUG-18 - Exact transcript receipt recovery

**Status:** RESOLVED IN SOURCE AUTOMATION; REAL TRANSCRIPT RESTART GATE OPEN

**Previous:** an append acknowledgement loss marked the DeliveryAttempt `UNKNOWN`, while a retry could create a new attempt and effect key and bypass same-key transcript reconciliation.

**Implemented:** Delivery Specification binds the exact target identity, immutable artifact/digest, target revision, attempt number, requirement, and effect key. UNKNOWN reopens the existing attempt with the original effect; OpenClaw's in-transaction transcript scan returns the existing message id when the first append committed. Session rebound and unconfirmed results remain fail closed.

**Acceptance:**

- [x] A fake append writes one transcript event and then loses its acknowledgement.
- [x] After recreating service/runtime state, reconciliation uses the original effect key, confirms the existing message, and completes the Run.
- [x] The transcript contains exactly one matching message and the DeliveryAttempt count remains one.
- [x] Manual retry of an `UNKNOWN` Delivery cannot create a new effect key; definite `RETRY_REQUIRED` failures may still create a new attempt.
- [x] Session rebound and ambiguous/failed reconciliation remain visible and do not complete the Run.

## BUG-19 - Capability evidence semantics

**Status:** RESOLVED IN CONTRACT SEMANTICS; REAL BEHAVIOR GATE OPEN

**Implemented:** capabilities identify feature flags as `DECLARED_PLUGIN_CONTRACT`, explicitly return `behaviorVerified=false`, include only structural checks, and point to the isolated real-Gateway behavior gate.

**Acceptance:**

- [x] Capability consumers can distinguish declared support from exercised behavior.
- [x] Documentation does not use a capabilities-only call as proof for Task/transcript/restart behavior.
- [ ] The real-Gateway P0 matrix supplies the missing behavioral evidence.

## BUG-20 - RPC registration and error boundary

**Status:** RESOLVED IN SOURCE AUTOMATION

**Acceptance:**

- [x] All 40 methods register exactly once with their declared operator scope.
- [x] Every handler is invocable and responds exactly once.
- [x] Service-unavailable, CollaborationError details, and unknown errors map fail closed.

## BUG-21 - Explicit Attempt recovery State Machine

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** Task observations are reduced by a pure Attempt recovery State Machine into explicit `NOOP`, `KEEP_UNKNOWN`, `CAPTURE_AND_WATCH`, `REQUEST_CANCEL`, or `SETTLE` decisions. The reducer has no database or runtime side effects; the service applies decisions under current Run/Attempt revisions.

**Acceptance:**

- [x] queued/running/succeeded/blocked/failed/timed-out/cancelled/lost Task states have explicit decisions.
- [x] sticky cancellation changes queued/running decisions into cancellation requests.
- [x] absent, ambiguous, mismatch, lookup failure, and retry exhaustion never authorize redispatch.
- [x] recovering one UNKNOWN Attempt does not clear another recovery blocker.

## BUG-22 - Lease-fenced Command Result Committer

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** command ownership is the compare key `id + lease_owner + attempts`. `attempts` is a monotonic lease-fencing generation, not a retry budget. Long effects renew the lease. `commitClaimedCommandResult()` settles the exact claimed command and applies its domain result in one SQLite transaction; stale owners cannot update Attempt, Delivery, Run, or Flow revision.

**Acceptance:**

- [x] A stale Delivery worker cannot commit transcript success; the replacement owner reconciles the same effect.
- [x] A stale cancellation worker cannot commit Task cancellation; the replacement owner closes the same command.
- [x] Dispatch changes `CREATED -> DISPATCHING` only while the current command lease is atomically renewed.
- [x] A fresh reclaimed lease cannot be stolen by orphan recovery.

## BUG-23 - Schema 10 delayed Durable Outbox, failure budget, and effect intent

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** the v7 migration added `commands.available_at` and its availability index; v8 added `failure_count`; v9 added `effect_started_at`; v10 added Flow reconciliation abandonment evidence to tombstones. `FailureRetryPolicy` consumes only `failure_count`, while `attempts` remains the lease generation. Infrastructure deferrals change `available_at` without consuming the failure budget. Before a PROVISION create call, the claimed lease records `effect_started_at`; it is durable evidence that the effect may have started, not a success receipt. Exhaustion produces a visible failed command and `RECONCILE`; the operator reopens the same command/effect, clears only `failure_count`, and preserves lease/effect history.

**Acceptance:**

- [x] v6 -> v7 migration preserves commands and backfills `available_at=0`; v7 -> v10 migrations backfill `failure_count=0`, preserve it across v9, add nullable `effect_started_at`, and add nullable tombstone audit columns.
- [x] A delayed command is not claimable before its due time.
- [x] Lease reclaim increments `attempts` without consuming `failure_count`; business failure consumes policy budget; maintenance/session deferral consumes neither.
- [x] Manual reconcile clears `failure_count` while preserving `attempts`, `effect_started_at`, command id, and effect key.
- [x] PROVISION retry reuses the controller-bound Managed Flow.
- [x] Terminal FLOW_SYNC failure exposes `RECONCILE`; manual retry uses the same effect and clears the action after success.

## BUG-24 - Background Lifecycle Supervisor

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** a Lifecycle Supervisor owns background tasks, keyed single-flight, intervals, deferred work, unreferenced timers, runtime races, errors, AbortSignal, and shutdown drain.

**Acceptance:**

- [x] Background failure is observed even when no caller awaits the task.
- [x] Keyed work coalesces concurrent calls and can run again after settlement.
- [x] close is idempotent, aborts raced runtime work, clears timers, and drains tasks registered by in-flight tasks.
- [x] Service stop releases every unprocessed command lease from a claimed batch.

## BUG-25 - Recoverable two-phase Managed Flow cancellation

**Status:** RESOLVED IN ADAPTER AUTOMATION; REAL GATEWAY BEHAVIOR OPEN

**Implemented:** `requestCancel(expectedRevision)` persists cancel intent and advances Flow revision. `cancel()` performs the second phase. A retry with the original expected revision recognizes `cancelRequestedAt` and `revision=expected+1`, skips duplicate request, and resumes cancellation.

**Acceptance:**

- [x] If request succeeds and cancel throws, retry does not call request again.
- [x] `getManagedFlow()` exposes `cancelRequestedAt`.
- [x] Success requires `found=true`, `cancelled=true`, and returned Flow status `cancelled`.
- [ ] The same recovery window is exercised against an isolated real Gateway.

## BUG-26 - Nested SQLite Unit of Work

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** nested database transactions use unique SAVEPOINTs. An inner failure rolls back and releases only its savepoint; the outer transaction remains authoritative. Transaction APIs reject asynchronous callbacks in the type system and detect any native Promise or custom `PromiseLike` at runtime before commit.

**Acceptance:**

- [x] A failed nested transaction rolls back its writes while the outer transaction continues.
- [x] stop/cancel/session-fence helpers can participate in an existing command transaction without opening a second top-level transaction.
- [x] A PromiseLike result rolls back a top-level transaction; inside a nested transaction it rolls back only that savepoint and cannot escape the synchronous better-sqlite3 boundary.

## BUG-27 - Durable session mutation fence

**Status:** RESOLVED IN SOURCE AUTOMATION; REAL CORE RPC BEHAVIOR OPEN

**Implemented:** reset/delete creates a durable PREPARED fence before the core RPC. It blocks new plans, resume, and queued dispatch. Policies support cancel-and-wait and stop-and-retarget. An expired fence remains unresolved until an explicit recovery completion records the unknown core result.

**Acceptance:**

- [x] Prepare and complete are replayable and operation/payload bound.
- [x] CREATED queued dispatch is safely cancelled; DISPATCHING becomes UNKNOWN and cannot be redispatched.
- [x] Expiry leaves affected Runs in ATTENTION_REQUIRED through restart reconciliation.
- [ ] Reset/delete identity and recovery are exercised against an isolated real Gateway.

## BUG-28 - Controller-unique Managed Flow provisioning and terminal closure

**Status:** RESOLVED IN SOURCE AUTOMATION; REAL GATEWAY BEHAVIOR OPEN

**Previous:** a reclaimed PROVISION lease could not prove whether creation had started, and a closing Run could accidentally create a new Flow or accept a controller/revision/status mismatch.

**Implemented:** the adapter anti-corruption layer exposes exact owner-session/controller lookup as `FOUND`, `ABSENT`, or `AMBIGUOUS`. Ambiguity fails closed; a create result must be discoverable in the owner registry by the same controller. `ProvisionExecutionPolicy` permits `CREATE_OR_RECOVER` only for an unfenced `PROVISIONING` Run, defers fenced provisioning, and restricts `CANCELLING` plus all terminal Runs to `OBSERVE_ONLY`. Shared identity, provisioning, and closure Specifications validate controller, run, Flow identity, revision range, status, domain status, and cancellation intent.

Closing observation maps `COMPLETED/CANCELLED/FAILED` to `succeeded/cancelled/failed`. A valid existing Flow is recorded and converged; `ABSENT` settles without creating; a verified conflict persists the Flow reference, fails the original PROVISION command, creates an Intervention, moves reconciliation to `ATTENTION_REQUIRED`, and exposes `RECONCILE`.

**Acceptance:**

- [x] Zero/one/multiple controller matches produce `ABSENT/FOUND/AMBIGUOUS`, and duplicate controllers never select an arbitrary Flow.
- [x] The create path writes `effect_started_at` under the exact command lease before calling OpenClaw and verifies registry visibility after creation.
- [x] Maintenance/session fences defer active provisioning without consuming the failure budget; terminal closure remains observe-only and cannot deadlock cancel-and-wait.
- [x] Provisioning rejects a non-running or cancel-requested Flow; closure rejects wrong controller/run/Flow, out-of-range revisions, conflicting terminal states, and invalid cancellation intent.
- [x] A terminal conflict remains product-visible with Intervention and `RECONCILE`; an absent terminal Flow does not create a replacement.
- [ ] The same lookup and closure matrix passes against an isolated real Gateway.

## BUG-29 - Durable timeout cancellation outbox

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** timeout detection atomically moves the Attempt (and WorkItem where applicable) to `CANCELLING`, stops dispatch, records the transition, and ensures a `CANCEL_ATTEMPT` command with `terminalReason=TIMEOUT`. Restart derives timeout intent from the durable command payload. Only confirmed remote Task cancellation can settle `TIMED_OUT`; missing identity, runtime errors, or unconfirmed cancellation remain `UNKNOWN` with an Intervention.

**Acceptance:**

- [x] A crash after the timeout transaction cannot lose the cancellation intent.
- [x] Reconciliation recreates actionable cancellation from the durable TIMEOUT command without inferring from a timer.
- [x] A cancellation response that is absent, throwing, or unconfirmed cannot claim `TIMED_OUT`.

## BUG-30 - Atomic terminal Flow synchronization repair

**Status:** RESOLVED IN SOURCE AUTOMATION

**Implemented:** every Run transition to `COMPLETED`, `CANCELLED`, or `FAILED` enqueues its terminal `FLOW_SYNC` effect in the same SQLite transaction. Startup repair scans terminal Runs with a persisted Flow but no matching terminal sync command, rechecks inside a transaction, and inserts only the missing effect. FLOW_SYNC retry uses `failure_count` and the original command/effect.

**Acceptance:**

- [x] Terminal domain state cannot commit without its corresponding new FLOW_SYNC command on current code paths.
- [x] Startup repair fills a legacy/missing terminal command and does not duplicate an existing terminal effect.
- [x] COMPLETED, CANCELLED, and FAILED map to finished, cancelled, and failed Flow outcomes respectively.

## BUG-31 - Retention-safe explicit Flow reconciliation abandonment

**Status:** RESOLVED IN SOURCE AUTOMATION; BROWSER VISUAL QA OPEN

**Implemented:** automatic retention rejects non-IDLE reconciliation, active/unknown commands, every unfinished FLOW_SYNC, and failed PROVISION. It has no abandonment authority. Explicit delete preview returns a structured Flow reconciliation blocker and binds its command id/status, Flow id/revision, bounded diagnostic, Run revision, and content digest into the confirmation token. The UI requires three gates: a current server preview; a non-empty reason plus separate permanent-abandonment checkbox; and the final permanent-delete checkbox. The service recomputes the blocker transactionally and requires `abandonFlowReconciliation=true`, otherwise it returns `FLOW_RECONCILIATION_REQUIRED`.

Successful abandonment writes `flow_reconciliation_command_id`, `openclaw_flow_id`, `openclaw_flow_revision`, `flow_reconciliation_diagnostic`, `flow_reconciliation_abandoned_at`, and `flow_reconciliation_abandon_reason` to the tombstone. The Desktop error-code allowlist preserves `FLOW_RECONCILIATION_REQUIRED`. Its pure preview-recovery policy invalidates the stale token and refreshes the authoritative Run for that DELETE error, and does the same for `REVISION_CONFLICT` on DELETE/PARTIAL. Tombstone decoding requires a complete abandonment evidence group, and the history drawer renders it without deleted business content.

**Acceptance:**

- [x] Retention leaves a Run with failed PROVISION or unfinished/failed FLOW_SYNC untouched.
- [x] A blocker change after preview produces `REVISION_CONFLICT`; deletion without explicit abandonment produces `FLOW_RECONCILIATION_REQUIRED`.
- [x] Frontend recovery discards DELETE/PARTIAL previews on the specified errors before fetching the current snapshot; it never automatically replays the destructive command.
- [x] A valid explicit deletion persists the exact blocker evidence, timestamp, and bounded reason in the tombstone and exposes it through the audited history projection.
- [x] Fake abandonment fields without a server-reported blocker are rejected.
- [ ] Desktop/mobile browser QA confirms the three gates and tombstone evidence remain legible and keyboard-accessible.

## BUG-32 - Exact UI projection epoch and incomplete audit timeline

**Status:** RESOLVED IN SOURCE AUTOMATION; BROWSER VISUAL QA OPEN

**Implemented:** collaboration data is visible only when the Gateway is connected, RuntimeIdentity is verified, the identity connection id equals the projection connection id, and runtime id equals collaboration instance id. Disconnect, instance replacement, and reset invalidate the projection epoch, polling, request generations, in-flight deduplication, cached runs/events/tombstones, and connection-scoped dialogs. Late responses from an old connection cannot repopulate a new projection.

Event synchronization treats push as a hint. Cursor invalidation, a pruned-event gap, or the client page limit retains `complete=false` plus `incompleteReason`, refreshes the authoritative Run snapshot, and renders an explicit incomplete-timeline warning instead of presenting the visible event subset as a complete audit.

**Acceptance:**

- [x] A disconnect clears the projection once and hides cached Run/history state until exact runtime rebinding succeeds.
- [x] Connection ABA and instance replacement reject late session/global/event/tombstone responses from the prior projection epoch.
- [x] A cursor gap or page limit keeps the audit timeline visibly incomplete while the latest Run snapshot remains available.
- [ ] Desktop/mobile browser QA confirms transition states do not flash stale collaboration data.

## BUG-33 - Ambiguous Flow reconciliation deletion authority

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** deletion preview selected one failed `FLOW_SYNC/PROVISION` with
`LIMIT 1`, while execution treated the presence of that single abandonment as
authority to ignore every failed Flow command. Two unresolved commands could
therefore be deleted while the tombstone preserved evidence for only one.

**Implemented:** `RunDeletionRepository` is a read-only Query Repository. Its
snapshot contains the complete decision facts and at most two stable blocker
witnesses, which is sufficient to distinguish zero, one, and at least two
failed Flow commands without claiming an exact total. `RunDeletionPolicy` is a
pure application policy with separate preview, explicit execution, retention,
and retry assessments. Explicit abandonment is valid only for one exact
blocker; at least two always returns `FLOW_RECONCILIATION_REQUIRED`. A satisfied
preview is not execution authority. The DELETE worker re-reads the snapshot and
re-evaluates policy inside its IMMEDIATE transaction. Staging, digest/token,
job, tombstone, cascade, rollback restore, and post-commit cleanup remain owned
by the Service deletion saga.

**Acceptance:**

- [x] Zero, one, and at least two failed Flow commands produce no witness, one exact witness, or an ambiguous bounded witness set in stable priority order.
- [x] A second failed Flow command created after preview invalidates both request acceptance and an already queued DELETE at execution time, even when Run revision, digest, and the original blocker are unchanged.
- [x] Exact single-blocker abandonment still succeeds and persists one complete tombstone evidence group; fabricated abandonment without a server blocker is rejected before job creation.
- [x] Retention and explicit deletion consume the same strict snapshot facts but different policy entry points; retention has no abandonment parameter or authority.
- [x] Delete retry preserves prior abandonment only while one exact blocker still exists; disappearance drops old abandonment and change/ambiguity requires a new preview.

## BUG-34 - Retention cursor starvation

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** retention scanned a broad page of 500 expired terminal Runs every
six hours but discarded an unfinished cursor after 24 hours. A permanent
blocked prefix of more than 2,000 Runs could therefore force every cycle back
to the beginning and indefinitely starve a later eligible Run.

**Implemented:** the stable `(ended_at, id)` cursor now advances until the
ordered scan is actually exhausted. Batch/page/time-budget interruption keeps
the cursor and, while the service is running, schedules a one-second
continuation. Candidate selection remains a broad indexed optimization;
strict `RunDeletionPolicy` assessment remains the authority. Dedicated indexes
cover terminal candidates and Run-scoped active Attempt/command, failed Flow,
export, and deletion-job facts.

**Acceptance:**

- [x] A legacy cursor older than 24 hours resumes after its last key instead of restarting at the blocked prefix.
- [x] Candidate pagination uses strict `ended_at < cutoff` and stable `(ended_at, id)` ordering while still including policy-blocked Runs.
- [x] Every processed candidate, including a policy skip, participates in the 250 ms sweep budget.
- [x] An unfinished page retains its cursor and schedules near-term continuation; only an exhausted ordered scan clears the cursor.
- [x] Existing schema 10 databases receive all deletion-query indexes idempotently without a destructive migration.

## BUG-35 - OpenClaw plugin API upper-bound installability

**Status:** RESOLVED IN SOURCE; applicable isolated real-Gateway verification is current, while broader release gates remain open

**Previous:** package metadata used `>=2026.7.1 <2027`. OpenClaw `2026.7.1`
accepted the metadata shape but its plugin API comparator evaluated that partial
upper bound as non-matching, so the then-generated tgz could not be installed.

**Implemented:** the peer and plugin API ranges now use the fully qualified
`>=2026.7.1 <2027.0.0` boundary, and package validation locks that exact
contract.

**Acceptance:**

- [x] OpenClaw's actual `satisfiesPluginApiRange` returns true for the declared range and runtime `2026.7.1`.
- [x] Re-run managed `npm-pack:` installation for the current `bea9b0ac...` tgz in the pinned OpenClaw `2026.7.1` container.
- [x] Reconfirm current-bundle RPC registration, schema 11 SQLite startup, and instance identity across a graceful Gateway restart; structural evidence is `.artifacts/collaboration-real-gateway-owner-ttl-20260719/20260718213349-264598dc20/evidence.json`.

## BUG-36 - Agent authorization pre-effect fence

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** plan approval captured an Agent configuration, but a later
allowlist revocation or capability configuration change was not an
authoritative pre-effect decision. A durable dispatch command could therefore
reach `runtime.subagent.run()` using stale authority.

**Implemented:** the pure `evaluateEffectiveAgentAuthorization()` and
`decideAgentDispatchAuthorization()` Specifications evaluate the effective
configured/allowed Agent set together with the Run's persisted capability
config hash. `CollaborationService` performs that check in the
authoritative transaction immediately before moving an Attempt from `CREATED`
to `DISPATCHING`; `OpenClawRuntimeAdapter` repeats the effective authorization
check as a defense-in-depth boundary. Denial atomically fails the command and
Attempt, moves the WorkItem to `NEEDS_INTERVENTION`, moves the Run to
`AWAITING_INTERVENTION` with `ATTENTION_REQUIRED`, records bounded audit and
Intervention evidence, closes queued dispatches, and never retries the denied
external effect.

**Acceptance and regression:**

- [x] Revoking a worker, planner, or coordinator after approval but before effect execution prevents every `runtime.subagent.run()` call.
- [x] A missing or changed persisted capability config hash fails closed before the Attempt enters `DISPATCHING`.
- [x] Authorization denial commits command, Attempt, WorkItem, Run, event, and Intervention state atomically and consumes no external-effect retry.
- [x] Direct adapter invocation cannot bypass the effective Agent allowlist.

## BUG-37 - Collaboration instance write fence and 0.3 wire contract

**Status:** RESOLVED WITH BREAKING PLUGIN `0.3.0` CONTRACT

**Previous:** write envelopes were not bound to the exact collaboration plugin
instance. After database replacement, reinstall, or connection ABA, a stale
Desktop projection could submit a syntactically valid mutation to a new
instance, and an idempotency receipt alone could not prove the intended
instance.

**Implemented:** every `CollaborationWriteEnvelope` requires
`expectedCollaborationInstanceId`; it participates in the canonical payload
hash and is validated before any domain mutation. Plan create/clone and session
mutation paths bind origin runtime identity to the authoritative database
instance. Every normal and replay response carries the actual
`collaborationInstanceId`, and the Desktop wire codec requires it to equal the
request expectation. This is intentionally a breaking `0.3.0` protocol: legacy
`0.2.x` write envelopes without the instance fence are rejected rather than
silently rebound. Capability discovery advertises `WRITE_INSTANCE_FENCE`.

**Acceptance and regression:**

- [x] A missing, stale, or mismatched expected instance id is rejected before receipt insertion or domain mutation.
- [x] The instance id changes the canonical request digest, while exact same-instance retries replay the original stamped response.
- [x] Plan create/clone cannot persist a caller-spoofed origin runtime id, and session mutation lifecycle writes remain bound to the verified instance.
- [x] Desktop run actions, maintenance/session coordinators, stores, and response decoders propagate and verify the same projection instance id.
- [x] Package metadata, plugin manifest, generated bundle metadata, and capability features expose the breaking `0.3.0` contract consistently.
- [ ] A real Desktop instance-replacement/reconnect exercise confirms the UI never auto-rebinds a pending write to the new instance.

## BUG-38 - Current-plan aggregate boundary

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** current-plan selection and WorkItem lookup were repeated across
commands, and some paths could select a historical WorkItem by logical id.
Plan revision also checked quiescence too narrowly, allowing an active or
`UNKNOWN` Attempt from another revision or kind to complete after the new plan
became current.

**Implemented:** `CurrentPlanScopeRepository` is the single Query Repository
for the Run's current plan pointer, current WorkItem membership, dispatch and
concurrency facts, required-item settlement, synthesis evidence, and waiver
updates. Plan revision requires quiescence across all Attempt revisions and
kinds, including `UNKNOWN`, both before and inside the transaction. Worker and
Synthesizer Attempts carry an exact `planRevisionId`; a historical late
completion is changed to `ABANDONED` with audit evidence and cannot commit
current-plan output. Historical plans remain intact for audit/export and are
not relabelled as waived.

**Acceptance and regression:**

- [x] Every WorkItem command rejects a historical plan revision even when its logical id is reused by the current plan.
- [x] Plan revision is rejected while any worker, planner, coordinator, or synthesizer Attempt from any revision is active or `UNKNOWN`.
- [x] A late historical Worker or Synthesizer completion is audited as `ABANDONED` and cannot settle, synthesize, or advance the current plan.
- [x] Dispatch capacity, all-required settlement, upstream evidence, and synthesis selection consume the same current-plan scope.
- [x] Audit/export retains every historical plan and its original status.

## BUG-39 - Durable maintenance lease expiry recovery

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** a process interruption could leave a maintenance lease whose
wall-clock expiry was not converted into an explicit durable recovery state.
Repeated inspection could duplicate recovery effects, while malformed lease
content risked either reopening the write gate or leaving an opaque permanent
lock.

**Implemented:** `MaintenanceLeaseSpecification` strictly parses bounded lease
content into `ACTIVE`, `EXPIRED`, or `MALFORMED`, including the legacy persisted
shape. `MaintenanceLeaseRepository` uses SQLite compare-and-set to record an
expiry transition. Recovery keeps the maintenance gate closed, records one
`MAINTENANCE_LEASE_EXPIRED` event and Intervention per active Run, marks
reconciliation `ATTENTION_REQUIRED`, and closes queued commands. Repeated
status, capabilities, and startup recovery are idempotent. Exit requires the
exact lease id and stable Desktop owner in the Repository CAS; a foreign
Desktop cannot release another operation's gate. The 45-minute lease covers
the Rust updater's 30-minute deadline, and Desktop revalidates the authoritative
lease at the mutation use point with a 37-minute minimum remaining window (30 minutes for the bounded package/fallback command, five minutes for Gateway recovery and final version verification, plus two minutes for IPC, reconnect verification, and exact lease release). An expired lease is never released by the normal completion path; it requires explicit recovery.
Malformed or short-lease state remains fail closed with an inspectable diagnostic.

**Acceptance and regression:**

- [x] The first post-expiry inspection commits one durable `EXPIRED` transition and one recovery signal per affected Run.
- [x] Concurrent or repeated recovery cannot duplicate expiry events, Interventions, or queued-command closure effects.
- [x] Expired and malformed leases keep the gate closed; malformed content is preserved for diagnosis instead of being deleted as inactive.
- [x] A mismatched lease id or owner cannot release maintenance, a short legacy lease cannot start the bounded update, and exact release does not auto-resume suspended Runs.
- [ ] The 24-hour restart/disk-fault soak confirms expiry recovery under repeated process and storage interruption.

## BUG-40 - Bounded OpenClaw runtime deadlines

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** an awaitable OpenClaw runtime call could remain pending forever,
holding a command lease or lifecycle shutdown without producing a durable
recovery decision.

**Implemented:** `RuntimeDeadlinePolicy` assigns a bounded timeout to each
runtime operation, and the `withRuntimeDeadline` Decorator wraps origin reads,
Managed Flow calls, Agent dispatch, Task lookup/wait/cancel, session history,
and transcript append. Timeout produces structured `RUNTIME_TIMEOUT` failure,
cleans its timer, and absorbs late resolve/reject. Dispatch, append, cancel,
and Flow recovery retain the existing `UNKNOWN`, idempotency/effect-key, and
no-duplicate-effect semantics.

**Acceptance and regression:**

- [x] Every awaitable Runtime boundary uses the operation-specific deadline policy.
- [x] Success, failure, timeout, abort, and shutdown paths release timers and produce no unhandled late rejection.
- [x] A hung Agent/append/cancel/Flow call enters the existing durable recovery path without repeating a potentially started effect.
- [x] Deadline values are validated as finite positive bounds and can be replaced through the policy abstraction in tests.
- [ ] The 24-hour fault soak confirms timer, lease, and task cardinality remain bounded under repeated runtime hangs.

## BUG-41 - Canonical OpenClaw history identity and content normalization

**Status:** RESOLVED IN SOURCE AUTOMATION; historical `P0-02` evidence is bound to the old bundle and must be rerun

**Previous:** history identity lookup preferred legacy top-level `id` and
`messageId` but did not recognize OpenClaw's canonical `__openclaw.id` shape.
History content could also be a block array; passing that value through as
`ChatMessage.content` allowed string-only UI paths such as `trim()` to fail and
made old cached messages unsafe after upgrade.

**Implemented:** the Gateway anti-corruption layer now prefers bounded,
control-safe `__openclaw.id` and falls back to legacy identity fields only for
compatibility. Shared history normalization always exposes plain text as
`ChatMessage.content`, preserves arrays as `rawContent` for tool/thinking/rich
block rendering, and migrates legacy cached messages through the same text
extractor. Realtime normalization also reads `rawContent` first, so preserving
the string invariant does not discard rich payloads.

**Acceptance and regression:**

- [ ] Re-run repeated real `chat.history` reads against the current bundle to establish a stable canonical native message identity for `P0-02`.
- [x] String and `[{ type: "text" }]` history payloads both produce safe plain-text `content`.
- [x] Tool, tool-result, and thinking blocks remain available from `rawContent` after history normalization.
- [x] Legacy top-level ids and cached array-valued messages migrate without losing stable identity or crashing string-only UI paths.
- [ ] Desktop/mobile browser QA confirms rich history, tool details, and cached-message migration render correctly.

## BUG-42 - Partial completion and terminal Run quiescence

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** partial acceptance could be evaluated only against the selected
WorkItem closure. An unrelated active Worker could therefore be ignored while
synthesis or a terminal Run transition was attempted.

**Implemented:** `SettlementSpecification` separates current-plan required
settlement, the requested partial waiver closure, and the full Run active/
`UNKNOWN` Attempt count. Partial acceptance only closes its own closure;
unrelated work remains visible and blocks synthesis. `enqueueSynthesis` and
`transitionRun` repeat the readiness check inside the authoritative transaction.
Terminal `COMPLETED/CANCELLED/FAILED` writes reject active or `UNKNOWN` Attempts.

**Acceptance and regression:**

- [x] A partial decision for Worker A cannot start synthesis while independent Worker B is active.
- [x] Worker B can settle afterward and the same partial decision then proceeds exactly once.
- [x] Any active/`UNKNOWN` Attempt blocks a terminal Run transition, except the explicitly documented residual-risk contract in BUG-45.
- [x] Readiness and terminal checks remain correct after restart/replay and do not rely on UI state.

## BUG-43 - Maintenance lease terminal completion and Delivery pre-effect fence

**Status:** RESOLVED IN SOURCE AUTOMATION; 24-HOUR SOAK OPEN

**Previous:** maintenance expiry could leave a Planner, Worker, or Synthesizer
Attempt in a suspended local phase. A terminal result then either failed to
settle or required an unsafe broad status assumption. Delivery could also pass
the maintenance gate after a long await and create an effect during maintenance.

**Implemented:** `TerminalAttemptCompletionPolicy` maps each Attempt kind to its
active Run phase and requires exact `resume_status`. Suspended phases are
bridged atomically before terminal CAS; mismatches remain Intervention. Delivery
rechecks maintenance immediately before transcript append and persists a defer
for the original command/effect key without consuming business failure budget.

**Acceptance and regression:**

- [x] Expired maintenance cannot strand Planner/Worker/Synthesizer terminal results.
- [x] Mismatched resume status is rejected fail closed; exact release permits one terminal completion.
- [x] Delivery defers during maintenance without a second effect key or failure-budget increment.
- [ ] Repeated restart/disk-fault soak validates the same behavior over 24 hours.

## BUG-44 - Export sidecar isolation

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** an oversized or otherwise failed `EXPORT` job could change the
orchestration Run to `AWAITING_INTERVENTION`, strand a `DELIVERY_PENDING` Run,
and leave no valid recovery path for the original delivery effect.

**Implemented:** export failure updates only `export_jobs` and returns before
the orchestration command-failure path. It cannot create `COMMAND_FAILED`,
change Run status, or alter Delivery. A regression covers maintenance-deferred
delivery, export limits, lease release, one transcript append, and eventual
Run completion.

**Acceptance and regression:**

- [x] Export size/event/materialization failures leave the orchestration Run and Delivery state unchanged.
- [x] Export failure does not consume Delivery retry budget or create a misleading Intervention.
- [x] The original Delivery effect key completes exactly once after maintenance release.

## BUG-45 - Explicit residual OpenClaw Task risk contract

**Status:** RESOLVED IN SOURCE AUTOMATION; REAL DESKTOP/REMOTE TERMINATION SOAK OPEN

**Previous:** an UNKNOWN Attempt could be locally abandoned while the real
OpenClaw Task was still running, creating an ambiguous terminal Run and unsafe
delete/retention behavior.

**Implemented:** `ResidualExecutionRiskSpecification` allows `ABANDONED` only
when Run=`CANCELLING`, Attempt=`UNKNOWN`, the operator explicitly accepts the
risk, no PENDING/LEASED cancellation command remains, and durable evidence
proves a cancellation effect started or a valid reconciliation occurred. The
local Run may then become `CANCELLED`, but `reconcileState` stays
`ATTENTION_REQUIRED`; an open intervention and decision/event preserve Task,
run, owner/child-session, termination semantics, actor, and time. No late
result can write evidence/artifact, no redispatch occurs, and clone/delete/
retention fail closed. The Desktop card/details show a persistent risk notice.

**Acceptance and regression:**

- [x] Missing proof, actionable cancellation, wrong Run phase, or missing explicit acceptance produces zero writes.
- [x] Accepted risk produces the complete audit record, persists through Flow sync/restart, and keeps the attention state.
- [x] Late Task results cannot mutate Evidence/Artifact; the same session can create a new Run without redispatching the old one.
- [x] Server `allowedActions` and UI hide clone/delete/retention while the risk intervention is open.
- [ ] Real Desktop exit/reconnect and remote Task termination soak confirms the user-facing recovery path.

## BUG-46 - Explicit dispatch stop must survive Worker completion

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** A Worker that completed while `stopDispatch` had put the Run in
`AWAITING_INTERVENTION/STOPPED` could restore the Run to `RUNNING/STOPPED`.
The unresolved `DISPATCH_STOPPED` Intervention then removed the only valid
resume path and dependent WorkItems never dispatched.

**Implemented:** `WorkerPhaseRestorationPolicy` treats an unresolved
Intervention, pending partial decision, maintenance gate, or session mutation
as a durable phase fence. Worker completion may settle the Attempt and current
WorkItem, but leaves the Run suspended with `resume_status=RUNNING` until the
operator resolves the exact fence. `DISPATCH_RESUME` then resolves the stop
Intervention and schedules the next ready WorkItem once, under normal CAS rules.

**Acceptance and regression:**

- [x] stop → Worker success leaves `AWAITING_INTERVENTION/STOPPED` and exposes `DISPATCH_RESUME`.
- [x] Explicit resume schedules the dependent Worker without a duplicate Attempt.
- [x] The late Worker result cannot silently resolve the operator stop decision.

## BUG-47 - Partial decision plan fence and active UNKNOWN closure

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** Partial selection could be empty or malformed, a pending partial
decision could race WorkItem/plan mutation, and a WorkItem marked
`NEEDS_INTERVENTION` could hide an active `UNKNOWN` Attempt. The durable
decision then had no exact current-plan fence.

**Implemented:** `PartialDecisionSpecification` requires bounded, non-empty,
canonical, unique logical IDs and binds the confirmation/durable decision to
the exact `planRevisionId`. Its durable codec rejects invalid JSON shape,
wrong array types, duplicate/overlapping/out-of-closure IDs, and size or
character violations. Pending partial decisions block input, cancel, retry,
reassign, and plan revise both before and inside the write transaction.
Application rechecks the durable plan fence and recomputes the closure from
the current plan DAG before applying; mismatch or corruption atomically
supersedes the decision and creates a `PARTIAL_DECISION_CORRUPT`
Intervention/Event. Current-plan active Attempt aggregation includes
`UNKNOWN` by logical id.

**Acceptance and regression:**

- [x] Empty selection and invalid IDs fail closed without writes.
- [x] Pending partial blocks all WorkItem mutation and plan revision paths.
- [x] Plan drift supersedes the durable decision and never waives a new plan.
- [x] UNKNOWN Attempt is included in `closure.activeIds` even when its WorkItem needs intervention.
- [x] Malformed durable payloads and injected/missing descendants are quarantined without any WorkItem becoming `WAIVED`.

## BUG-48 - Server-authorized residual-risk action projection

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** Desktop inferred `ABANDONED` eligibility from
`CANCELLING + UNKNOWN + ATTEMPT_RESOLVE_UNKNOWN`, although the server also
requires no actionable cancellation command and durable cancellation or
reconciliation evidence.

**Implemented:** Attempt snapshots project optional
`canAbandonWithResidualRisk`, computed by the same
`ResidualExecutionRiskSpecification` used by the transactional command. A
missing field from an older plugin decodes as `false`; a non-boolean field is
rejected. Desktop action builders and Dialog render `ABANDONED` only when the
server projection is exactly `true`; the server transaction remains the final
authority.

**Acceptance and regression:**

- [x] CANCELLING+UNKNOWN without evidence does not expose `ABANDONED` in UI.
- [x] Valid evidence exposes the option only with explicit residual-risk confirmation.
- [x] Wire compatibility is fail-closed for missing/invalid projection fields.

## BUG-49 - Partial application must preserve recovery fences

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** a corrupt durable partial decision was quarantined, but a later
partial acceptance/application path could leave the corruption Intervention
open or advance around unrelated recovery facts. That made a fresh operator
decision insufficiently explicit and allowed synthesis to erase attention.

**Implemented:** `PartialApplicationPolicy` evaluates maintenance, unresolved
session mutation, and Intervention scope as a pure `PROCEED/DEFER` decision
both before and inside the write transaction. A fresh accept explicitly
resolves the prior `PARTIAL_DECISION_CORRUPT`/dispatch-stop decision; apply
resolves only Intervention entities in the exact current-plan closure and
then asserts that the full Run has no recovery blockers before waiving work
or entering `SYNTHESIZING`.

**Acceptance and regression:**

- [x] A corrupt decision waives no work and creates a durable Intervention.
- [x] A fresh explicit accept supersedes the corrupt decision and records its exact resolution.
- [x] Maintenance, session mutation, or an Intervention outside the waiver closure defers application.
- [x] Closure resolution, waiver, blocker assertion, and synthesis transition commit atomically.

## BUG-50 - Recovery projection must remain monotonic at terminal boundaries

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** cancellation command settlement could change
`canAbandonWithResidualRisk` without changing a Run field, so Desktop could
discard the same-watermark change hint forever. Delivery completion could
also overwrite an unrelated open recovery Intervention with `IDLE`.

**Implemented:** the cancellation Command Result Committer now advances Run
revision and appends `ATTEMPT_CANCELLATION_COMMAND_SETTLED` in the same
transaction as command/business settlement. Delivery confirmation recomputes
all Run recovery blockers after resolving its own Intervention and preserves
`ATTENTION_REQUIRED` when any blocker remains.

**Acceptance and regression:**

- [x] Cancellation settlement changes the projection watermark exactly once under command lease/CAS.
- [x] The refreshed snapshot exposes the newly authorized residual-risk action only when the server specification permits it.
- [x] Delivery completion preserves attention while an unrelated recovery Intervention remains open.

## BUG-51 - Intervention lifecycle classification at retry and cancel boundaries

**Status:** RESOLVED IN SOURCE AUTOMATION

**Previous:** retry resolved only the WorkItem Intervention, leaving the
terminal predecessor Attempt Intervention open. Conversely, immediate Run
cancellation could reach `CANCELLED/IDLE` while a recovery Intervention was
still open because reconciliation had not run yet.

**Implemented:** `InterventionResolutionPolicy` classifies resolution facts
before mutating them. WorkItem retry resolves only its current WorkItem and
terminal predecessor Attempts; active, UNKNOWN, and residual-risk Attempts
remain blockers. Run cancellation resolves only local facts explicitly
superseded by cancellation, then recomputes all blockers and writes
`ATTENTION_REQUIRED` when an external Flow, maintenance, session, or residual
risk fact remains.

**Acceptance and regression:**

- [x] Failed Attempt -> retry resolves the predecessor Intervention and restores `IDLE` only when no blocker remains.
- [x] Retry never resolves an active, UNKNOWN, or explicitly abandoned Attempt.
- [x] Immediate cancellation resolves local dispatch facts but preserves an external Flow blocker and `ATTENTION_REQUIRED`.
- [x] Resolution and terminal Run transition are atomic and auditable.

## External release gates

- [x] Re-run `P0-01` structural and `P0-02/03/05/06/07/08` behavioral contracts against the current `bea9b0ac...` bundle. Structural evidence is `.artifacts/collaboration-real-gateway-owner-ttl-20260719/20260718213349-264598dc20/evidence.json`; payload-free behavioral evidence is `.artifacts/collaboration-behavioral-gateway-owner-ttl-20260719/20260718213129-521c5279a4/evidence.json`.
- [ ] `P0-04/09/10/11/12/13/14` pass against the required real core-RPC, Desktop lifecycle, trust-boundary, capability, UI, and no-plugin absence-attestation environments.
- [ ] Two-phase Managed Flow cancellation and the complete session reset/delete product flow pass their real restart/race windows.
- [ ] The real Desktop exit/reconnect/instance-replacement workflow recovers durable state without stale projection or write rebinding.
- [ ] At least 24 hours of restart, network/disk fault injection, Task/Flow retention, runtime-hang, and security soak passes.
- [ ] Browser visual QA passes; DOM/SSR coverage alone is not visual evidence.

These product gates are necessary but not sufficient for production. The release-chain controls in [`specs/2026-07-18-openclaw-collaboration-release-evidence-bugfix.md`](2026-07-18-openclaw-collaboration-release-evidence-bugfix.md) are also mandatory: current-source promotion and mainline integration, protected environments and signing scope, formal text-scanner coverage, actual soak/Linux runner provenance, attestation run/attempt and controller/target identity binding, and a unique immutable release writer.

The early 2026-07-17 `gateway run --dev` probe accessed default
`~/.openclaw` and remains rejected. The current pinned-container run installed
the `bea9b0ac...` tgz and passed structural RPC/service/SQLite/restart checks
without mounting the user profile. The isolated behavioral matrix verifies only
`P0-02/03/05/06/07/08`; its current evidence projection retains only fixed
operational event codes and redaction markers, with no prompt/plan JSON.
`P0-04/09/10/11/12/13/14`, two-phase Flow and session product gates, real Desktop
lifecycle, visual QA, and 24-hour soak remain open.
