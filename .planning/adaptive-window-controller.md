# Adaptive Window Controller Plan

## Execution order

| Phase | Bug | Files | Fix |
|---|---|---|---|
| A | BUG-WIN-01 | `src-tauri/src/window_sizing.rs`, `src-tauri/src/lib.rs` | Plan and apply size plus position in one physical-pixel coordinate system. |
| A | BUG-WIN-02 | `src-tauri/src/lib.rs` | Persist first-run completion only after a successful native adaptation. |
| B | BUG-WIN-03 | `src-tauri/src/lib.rs` | Replace per-event native work with one bounded debounced event worker. |
| B | BUG-WIN-04 | `src-tauri/src/window_sizing.rs` | Make DPI-independent sizing deterministic and overflow-safe. |
| C | BUG-WIN-05 | `src-tauri/src/lib.rs` | Propagate native errors and emit actionable diagnostics. |
| D | BUG-WIN-06 | `src-tauri/src/window_sizing.rs` | Cover Windows multi-monitor, negative origins, DPI and off-screen recovery. |
