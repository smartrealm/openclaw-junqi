# Gateway Self-Rescue Bugfix Spec

## Acceptance

### BUG-SR01

- Leaving setup invalidates the repair continuation.
- A completed obsolete repair never starts Gateway or changes the current setup screen.
- Navigation is disabled while a non-cancellable backend mutation is active.

### BUG-SR02 / BUG-SR03

- Every official repair entry calls one Tauri command and one internal runner.
- Repair, start, stop, and restart serialize through `GatewayProcess::operation_gate`.
- All repair buttons share global busy state and cannot start a concurrent restart.

### BUG-SR04 / BUG-SR06

- Streamed repair lines redact credential markers and have a character limit.
- Only a bounded diagnostic tail is retained.
- Timeout terminates descendants on Windows and the owned child on macOS/Linux.

### BUG-SR05 / BUG-SR07

- Direct retry calls only Gateway startup and preserves existing logs.
- Backend startup errors include a structured `retry`, `repair`, or `inspect_config` recommendation.
- Transient failures prefer retry; plugin convergence failures prefer official repair.

### Validation

- Frontend behavior tests cover cancellation, action routing, and global busy state.
- Rust tests cover classification, redaction, output bounds, and command construction.
- `npm test`, `npm run build`, `cargo fmt`, `cargo clippy`, and `cargo test --lib` pass.
