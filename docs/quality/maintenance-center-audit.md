# Maintenance Center Audit

Date: 2026-07-14

Scope: Settings maintenance UI -> Tauri commands -> OpenClaw validation/Doctor processes -> Gateway recovery.

## Critical

### BUG-M01 - Malformed structured output can be reported as healthy

**Location**: `src-tauri/src/commands/maintenance.rs`

The parser only verifies that keys exist. It does not require `valid`/`ok` to be booleans or `findings` to be an array. A malformed or version-incompatible payload can therefore leave fields as `None` while `healthy` becomes `true`.

**Impact**: the UI can display "No issues found" even though a scan result was not understood.

**Fix**: deserialize into typed config and Doctor envelopes. Any schema mismatch becomes a partial scan error and keeps the report unhealthy.

### BUG-M02 - Invalid config details are discarded

**Location**: `src-tauri/src/commands/maintenance.rs`

`openclaw config validate --json` returns invalid JSON/schema details in `issues`, while the collector only reads `errors` and `warnings`.

**Impact**: the exact bad path and message are replaced with a generic "configuration is invalid" row.

**Fix**: accept `issues` as error findings and preserve its structured path/message.

## Medium

### BUG-M03 - Repair becomes clickable before mandatory rescan completes

**Location**: `src/components/settings/MaintenanceCenter.tsx`

`repairing` is cleared before the follow-up scan awaits. A second scan/repair can enter while the first post-repair verification is still running.

**Fix**: keep the repair transaction busy through the rescan and publish the final report before unlocking controls.

### BUG-M04 - Findings and Gateway status lack application-native resolution actions

**Location**: `MaintenanceCenter.tsx`, `GatewayLifecyclePanel.tsx`, `SettingsPage.tsx`

The page detects plugin/config/MCP/security problems and shows Gateway state, but offers only a broad Doctor repair. Duplicate plugins and secret migration need the appropriate config screen; a stopped Gateway needs a recovery action.

**Fix**: route categories to the existing Advanced, Tools, and Secrets config tabs, and add an explicit recovery button to the reused Gateway lifecycle panel.

### BUG-M05 - Legacy raw Doctor command remains exposed

**Location**: `src-tauri/src/lib.rs`, `src-tauri/src/commands/gateway.rs`

The old `run_doctor` command is still registered despite having no caller. It bypasses the structured report, operation lock, timeout, and output controls.

**Fix**: remove the Tauri registration so all UI diagnostics use the maintenance command. Keep the legacy function untouched while `gateway.rs` has unrelated in-progress edits.

### BUG-M06 - Doctor repair streams raw output into application logs

**Location**: `src-tauri/src/commands/maintenance.rs`

Doctor repair stdout/stderr is copied verbatim into the Gateway log buffer. Plugin diagnostics can include sensitive environment/config material.

**Fix**: own repair in the maintenance module, discard child stdout/stderr, and retain only bounded lifecycle start/exit records.

### BUG-M07 - Unknown severities are downgraded to informational

**Location**: `src-tauri/src/commands/maintenance.rs`

Any new severity name falls through to `info`, which does not make the report unhealthy.

**Fix**: recognize explicit informational severities and fail closed by mapping unknown values to `warning`.

### BUG-M09 - Child output collection is unbounded

**Location**: `src-tauri/src/commands/maintenance.rs`

`Command::output()` buffers all stdout and stderr. A noisy or faulty plugin can make a diagnostics scan consume unbounded memory before the timeout fires.

**Fix**: stream both pipes concurrently with explicit byte caps, kill the child on overflow, and parse only the bounded stdout payload.

## Low

### BUG-M08 - Scan timestamp records start rather than completion

**Location**: `src-tauri/src/commands/maintenance.rs`

A long Doctor run can make the displayed check time materially stale.

**Fix**: stamp the report immediately before returning.
