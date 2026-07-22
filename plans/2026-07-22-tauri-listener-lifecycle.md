# Tauri Listener Lifecycle Plan

1. Complete BUG-01 by centralizing async cleanup and proving disposal races.
2. Complete BUG-02 by moving window, PTY, adapter, and metrics listeners onto
   the shared boundary.
3. Complete BUG-03 by terminating uncovered UI promise chains and mapping
   Gateway/startup failures to existing state.
4. Run targeted regressions, TypeScript, full tests, and production build.
