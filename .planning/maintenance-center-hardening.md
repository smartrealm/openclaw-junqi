# Maintenance Center Hardening Plan

## Execution Order

### Phase A - Result correctness

| Bug | File | Fix |
| --- | --- | --- |
| BUG-M01 | `src-tauri/src/commands/maintenance.rs` | Deserialize typed validation envelopes and reject incompatible payloads. |
| BUG-M02 | `src-tauri/src/commands/maintenance.rs` | Collect OpenClaw `issues` as error findings. |
| BUG-M07 | `src-tauri/src/commands/maintenance.rs` | Normalize unknown severity fail-closed. |
| BUG-M08 | `src-tauri/src/commands/maintenance.rs` | Record completion timestamp. |

### Phase B - Process safety

| Bug | File | Fix |
| --- | --- | --- |
| BUG-M05 | `src-tauri/src/lib.rs` | Remove legacy raw Doctor command registration. |
| BUG-M06 | `src-tauri/src/commands/maintenance.rs` | Own repair locally, discard raw output, and retain hidden background execution. |
| BUG-M09 | `src-tauri/src/commands/maintenance.rs` | Drain subprocess output concurrently with strict byte limits. |

### Phase C - Workflow closure

| Bug | File | Fix |
| --- | --- | --- |
| BUG-M04 | Settings maintenance components | Add category navigation and canonical Gateway recovery action. |
| BUG-M03 | `MaintenanceCenter.tsx` | Keep busy state through post-repair scan. |

### Phase D - Regression and validation

Add one regression contract per Bug ID. Run formatting, Rust tests, frontend tests, type checking, production build, cleanup searches, and desktop/mobile visual checks.
