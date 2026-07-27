# Tauri Command Boundary Specification

## Acceptance

- [x] `start_gateway` has a concrete `GatewayStatus` renderer result type.
- [x] Renderer Gateway log levels equal the Rust serialized enum.
- [x] Existing shared wrappers are reused by the adapter, log panel, and Wizard
      service handoff.
- [x] Ensure comments state selected-runtime-only behavior and no cooldown.
- [x] `attempted_fallback` is identified as a compatibility field, not an active
      fallback signal.
- [x] The only unique committed branch fix is integrated without replacing
      overlapping current-main work.
- [x] Active uncommitted worktrees are audited but not silently copied.
