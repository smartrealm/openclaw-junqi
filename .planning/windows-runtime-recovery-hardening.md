# Windows Runtime Recovery Hardening

## Phase A - Dynamic command context

| Bug | Files | Change |
| --- | --- | --- |
| BUG-WSR-01 | `system.rs`, `gateway.rs`, `openclaw_repair.rs`, `openclaw_update.rs`, `openclaw_cli.rs` | Resolve the installed binary and compatible Node once, then construct every native OpenClaw command from those exact paths. |
| BUG-WSR-06 | `paths.rs` | Continue parsing `.npmrc` until a real `prefix` value is found. |
| BUG-WSR-07 | `system.rs`, `setup.rs` | Derive a reinstall prefix from a verified package root, including Windows `.bin` shims. |

## Phase B - Recovery correctness

| Bug | Files | Change |
| --- | --- | --- |
| BUG-WSR-02 | `gateway_supervisor.rs`, `process_control.rs` | Reuse owned-child tree termination on Windows. |
| BUG-WSR-03 | recovery policy/UI entry points | Honor the parsed migration expiry outside setup as well as during onboarding. |
| BUG-WSR-04 | progress emitter, repair command, rescue UI | Emit typed terminal states and retain failure detail without permanently disabling retries. |

## Phase C - Diagnostic safety

| Bug | Files | Change |
| --- | --- | --- |
| BUG-WSR-05 | diagnostic sanitizer, Gateway/Docker readers, rescue request | Sanitize external diagnostic payloads at the Rust trust boundary and test credential redaction. |

## Verification

1. Rust unit tests for runtime resolution, package-root discovery, progress state,
   redaction, and owned process termination selection.
2. TypeScript behavior tests for recovery delay and retryable UI state.
3. Focused frontend test suite, Rust library tests, type check, diff check, and
   platform-neutral formatting checks.
4. Windows target compilation remains a CI responsibility when no local MSVC
   target is installed.
