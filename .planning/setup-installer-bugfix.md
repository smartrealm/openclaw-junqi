# Setup Installer Bugfix Plan

## Execution order

| Phase | Bug | Files | Fix |
| --- | --- | --- | --- |
| A | BUG-01 | `setup.rs` | Make npm network and lifecycle activity visible while preserving hang detection. |
| B | BUG-02 | `npm_registry.rs`, `setup.rs` | Surface the actual selected source order and package version. |
| C | BUG-03 | `system.rs`, Tauri registry, frontend setup flow | Detect and display npm plus post-install versions. |
| D | BUG-04 | `setup.rs`, `system.rs` | Hide all setup subprocesses and replace the Git wizard with managed MinGit extraction. |
| E | all | Rust and TypeScript tests | Add one regression contract per finding and run layered validation. |

## Completion

- [x] npm network activity, lifecycle output, heartbeat, and hang detection
- [x] dynamic registry order and resolved package version diagnostics
- [x] Git, Node.js, npm, and OpenClaw version rows
- [x] non-interactive Windows MinGit installation and hidden probes
- [x] Rust, TypeScript, frontend, localization, and boundary validation
