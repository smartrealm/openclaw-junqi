# OpenClaw Dynamic Node Runtime Plan

## Phase A - Runtime contract

| Bug | File | Fix |
| --- | --- | --- |
| NR-01 | `src-tauri/src/commands/node_runtime.rs` | Add npm-semver-backed requirement policy and release selection |
| NR-01/04 | `src-tauri/src/commands/system.rs` | Read installed `engines.node` with explicit fallback provenance |

## Phase B - Target discovery and repair

| Bug | File | Fix |
| --- | --- | --- |
| NR-03 | `src-tauri/src/commands/npm_registry.rs` | Return latest package Node requirement with registry selection |
| NR-02 | `src-tauri/src/commands/setup.rs` | Resolve a compatible Node release dynamically and download that version |
| NR-03 | `src-tauri/src/commands/openclaw_update.rs` | Validate target requirement before package replacement |

## Phase C - Validation

1. Test npm range parsing with OR, comparator, caret and wildcard forms.
2. Test package metadata extraction and legacy fallback.
3. Test LTS-first compatible release selection.
4. Test registry selection retains matching engine metadata only.
5. Run Rust format/check/full tests, frontend lint/tests/build, and diff checks.

## Phase D - Independent runtime lifecycle

| Concern | File | Design |
| --- | --- | --- |
| Windows Git releases | `src-tauri/src/commands/git_runtime.rs` | Resolve the architecture asset and publisher digest from official Release metadata |
| Runtime application service | `src-tauri/src/commands/managed_runtime.rs` | Expose status and independent update commands without leaking setup internals to the UI |
| Transactional activation | `src-tauri/src/commands/setup.rs` | Download and verify in isolated directories, then swap with rollback |
| User lifecycle UI | `src/components/settings/ManagedRuntimeSettingsPanel.tsx` | Show configured path, versions, policy source, live progress, and platform-appropriate actions |

## Lifecycle contracts

1. Fresh install reads the target OpenClaw package metadata before selecting Node.js.
2. Existing-install runtime maintenance preserves compatibility with the installed OpenClaw package.
3. OpenClaw update reads the exact target package metadata and prepares its runtime before replacement.
