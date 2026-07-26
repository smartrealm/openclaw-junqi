# Tauri Listener Lifecycle Audit

## Findings

### BUG-01 Critical: async unlisten rejection escaped global error handling

Location: `src/utils/tauriEvents.ts`

Tauri 2.11 returns an async unlisten implementation despite declaring
`UnlistenFn` as synchronous. A WebView reload or teardown can remove the
native callback before cleanup. The native bridge then reads a missing listener
entry and rejects with `listeners[eventId].handlerId`.

Impact: the global `unhandledrejection` handler replaces the app with a fatal
overlay even though the listener was already being disposed.

Fix: `releaseTauriUnlisten` captures sync and async cleanup failures;
`subscribeTauriListener` serializes registration-versus-disposal and makes
cleanup idempotent.

### BUG-02 Critical: window and PTY listeners bypassed lifecycle ownership

Locations: `DynamicIslandRuntime.tsx`, `terminalDropTarget.ts`,
`ShellTerminalPanel.tsx`, `tauri-adapter.ts`

Several listeners registered directly against the Tauri API. Their cleanup
could race window unmount or call an async unlisten without a rejection
handler.

Fix: every event listener now uses the shared lifecycle boundary. A source
regression test permits direct `@tauri-apps/api/event` imports only inside that
boundary.

### BUG-04 Medium: async event handlers are not awaited by the Tauri bridge

Location: `src/utils/tauriEvents.ts`

Tauri invokes JS callbacks without awaiting an accidental Promise returned by a
handler. A rejected async handler would therefore bypass normal component error
handling.

Fix: the shared subscriber catches both synchronous handler exceptions and a
thenable result. The only unnecessary async event callback was removed.

### BUG-03 Medium: fire-and-forget UI effects lacked terminal failure handling

Locations: `App.tsx`, `GatewayConnectionManager.ts`, QR, clipboard, sound, and
terminal helper components.

Rejected calls could surface as the same fatal global Promise Rejection.

Fix: UI-only effects now terminate with a handled fallback; Gateway starts and
session loading transition to their existing failure state instead.

## Verification

- Tauri listener tests cover dispose-before-registration, rejected async
  cleanup, and duplicate cleanup.
- TypeScript, production build, and the full test suite must pass before
  release.
