# Maintenance Center Hardening Specification

## BUG-M01 - Typed structured output

**Current**: required JSON keys are checked for presence only.

**Target**: config and Doctor payloads deserialize into typed envelopes.

**Acceptance**:
- [ ] Non-boolean `valid`/`ok` is a scan error.
- [ ] Non-array findings cannot produce a healthy report.
- [ ] A partial config result remains visible when Doctor parsing fails.

## BUG-M02 - Preserve invalid config issues

**Current**: `issues` is ignored.

**Target**: each issue is an error finding with its path and message.

**Acceptance**:
- [ ] Invalid JSON reports `<root>` and its parser message.
- [ ] Invalid schema reports the exact config path.

## BUG-M03 - Atomic repair and rescan UX

**Current**: controls unlock before post-repair scan finishes.

**Target**: repair remains busy until rescan succeeds or fails.

**Acceptance**:
- [ ] Scan/repair controls stay disabled throughout post-repair verification.
- [ ] The latest report is published before `repairing` becomes false.

## BUG-M04 - Application-native resolution

**Current**: findings have no targeted action and Gateway status is read-only.

**Target**: category actions open existing application config tabs; stopped/error Gateway state exposes recovery using the canonical manager.

**Acceptance**:
- [ ] Plugin/config findings open Advanced config.
- [ ] MCP findings open Tools config.
- [ ] Security findings open Secrets config.
- [ ] Gateway recovery does not launch a shell or terminal window.

## BUG-M05 - One diagnostics entry point

**Current**: legacy `run_doctor` is registered alongside structured maintenance.

**Target**: only structured scan and explicit repair remain callable from Tauri UI.

**Acceptance**:
- [ ] `run_doctor` is absent from `generate_handler!`.
- [ ] No frontend caller references `run_doctor`.

## BUG-M06 - No raw Doctor logs

**Current**: repair output is streamed verbatim.

**Target**: stdout/stderr are discarded; lifecycle result remains logged.

**Acceptance**:
- [ ] Repair retains hidden-window configuration on Windows.
- [ ] No Doctor stdout/stderr line is copied into the log buffer.

## BUG-M07 - Fail-closed severity

**Current**: unknown severity becomes `info`.

**Target**: only explicit info/pass values become `info`; unknown values become `warning`.

**Acceptance**:
- [ ] `critical` is an error.
- [ ] An unknown severity makes the summary unhealthy.

## BUG-M08 - Completion timestamp

**Current**: `checkedAtMs` is captured before commands run.

**Target**: it represents scan completion.

**Acceptance**:
- [ ] Final timestamp is assigned after both scan stages.

## BUG-M09 - Bounded child output

**Current**: scan commands buffer child output without a size limit.

**Target**: stdout and stderr are drained concurrently with fixed upper bounds.

**Acceptance**:
- [ ] Oversized output terminates the child and becomes a scan error.
- [ ] Timeout still terminates the child.
- [ ] The command remains hidden on Windows.
