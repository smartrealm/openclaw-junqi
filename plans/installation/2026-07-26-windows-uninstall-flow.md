# Windows Uninstall Flow Fix Plan

## Execution order

| Phase | Bug | Files | Change |
| --- | --- | --- | --- |
| A | BUG-WUF-01 | `src-tauri/src/commands/docker.rs`, `src-tauri/src/commands/uninstall.rs` | Add an ownership-verified uninstall-only Docker cleanup and invoke it only for persisted Docker mode. |
| B | BUG-WUF-02 | `src-tauri/installer-hooks.nsh` | Gate NSIS uninstall on helper exit code; abort with an actionable message on failure. |
| C | Both | Rust and Node regression tests | Prove selected managed cleanup, foreign preservation, nonzero propagation, and NSIS fail-closed behavior. |
| D | Both | validation | Run format, TypeScript, focused frontend tests, full Rust tests, Windows installer script tests, and diff hygiene. |

## Constraints

- Never remove user data, Docker images, Node, npm, Git, or OpenClaw package files.
- Never remove a foreign/unverifiable container or service.
- Keep cleanup idempotent.
- A cleanup failure must preserve the installed helper binary by aborting before NSIS removes the application directory.
