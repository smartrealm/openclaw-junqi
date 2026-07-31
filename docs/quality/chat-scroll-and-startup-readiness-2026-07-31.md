# Chat Scroll And Startup Readiness

Date: 2026-07-31

## Basis

The installed `react-virtuoso` 4.18.7 type contract exposes both `followOutput` and `scrollerRef`. The existing chat view already uses `followOutput` to protect a reader who scrolls away from the tail. Gateway `sessions.list` is the authoritative first snapshot for session identity, labels, run state, selected-model metadata, and active-session reconciliation.

## Previous Behavior

- Expanding or collapsing a completed execution group changed an already measured virtual-list item. While the reader was at the tail, the list could preserve its bottom edge and move the visible message upward.
- The application rendered the dashboard immediately after setup validation. `sessions.list` was still in flight, so the session-oriented surfaces were progressively populated after the route was visible.
- The first history hydration used the same guarded tail-follow path as streamed output. During Virtuoso measurement, its temporary non-bottom state caused that path to do nothing, leaving a newly opened session above its newest message.
- `loadSessions` collapsed a superseded request and a failed request into the same boolean result. A later session refresh could supersede the startup request, then incorrectly release the global loading surface through the failure path before the latest session snapshot reached the sidebar.

## Target Behavior

- Before an execution group changes height, capture the scroller offset, temporarily disable tail following, and restore that offset over the next two animation frames. The execution details expand below their own summary without moving the current reading position.
- Keep initial-history positioning separate from streamed-output following. Once the active history is hydrated, position it at the final item regardless of temporary virtual-list bottom state; reset that one-time position when the active session changes. Subsequent user scrolling still locks tail following.
- After cached setup validation, show the shared full-window loading surface until the first `sessions.list` snapshot has been reconciled into `chatStore` and the shared dashboard `sessions` plus `agents` groups have each reached a success or error terminal state. This is data readiness, not a timer.
- A failed first session read completes the loading phase as an error terminal state so the existing recoverable Gateway surfaces remain available. Optional Gateway-independent routes remain reachable.
- Session loading distinguishes `loaded`, `failed`, and `superseded`. Only the latest request can complete or fail the first-data gate; a superseded request leaves the loading surface in place for its replacement.
- Recent transcript and model catalog loading stay background work because their existing contracts support later refresh and retry; they are not misrepresented as complete during the first session snapshot gate.

## Verification

- `src/App.startup.test.ts` checks that the route gate is released by the authoritative session-read terminal paths and that its label is localized.
- `src/components/Chat/executionProcessViewport.test.ts` checks the execution toggle wiring captures and restores the virtual scroller position, and that initial history hydration bypasses reader-state guards exactly once per session entry.
- Desktop interaction remains to be verified on the macOS WebView: expand a completed process both at the conversation tail and while reading older messages.
