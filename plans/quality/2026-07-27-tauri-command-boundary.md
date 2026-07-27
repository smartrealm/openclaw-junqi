# Tauri Command Boundary Plan

1. Fetch all refs and classify committed branch deltas, stashes, and active
   worktree changes.
2. Verify command registration, Rust return types, and selected-runtime policy
   against local source and Tauri v2 documentation.
3. Tighten `tauri-commands.ts` result and enum types and correct stale comments.
4. Replace duplicate raw invokes with the canonical wrappers while preserving
   intentionally injected resolver boundaries.
5. Manually integrate the sole unique committed setup-flow fix around current
   main changes.
6. Add contract/regression coverage and run full project validation.
