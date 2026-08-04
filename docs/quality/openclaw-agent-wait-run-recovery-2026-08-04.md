# OpenClaw Agent Wait Run Recovery

Date: 2026-08-04

## Evidence

- The installed `openclaw@2026.7.1-2` schema exposes `AgentWaitParams` with a required non-empty `runId` and an
  optional non-negative integer `timeoutMs`.
- Its Gateway `agent.wait` handler reads the exact run from the Gateway dedupe and lifecycle state. With
  `timeoutMs: 0`, it does not submit, retry, or mutate work. A `timeout` result is conservatively not used for
  local settlement because it can describe either a waiting lookup or an upstream timeout outcome.
- JunQi already records the submitted idempotency key as an uncertain pending send and uses fenced
  `sessions.describe` plus `chat.history` reconciliation for durable session state.

## Finding

When a `chat.send` transport response is lost after dispatch, the existing session-history recovery eventually
resolves the delivery. It has no exact per-run terminal read before relying on session-wide state, so a completed
Gateway dedupe entry is not used during that ambiguity window.

## Change

1. Add a fenced read-only `agent.wait` client which always sends `timeoutMs: 0`, strictly verifies the returned
   run id and status, and fails closed on disconnect, stale connection, unsupported method, malformed result, or a
   mismatched run id.
2. Add a keyed single-flight reconciler that invokes the client only for a currently recorded `uncertain` pending
   send, with both connection and local-observation fences.
3. A confirmed exact terminal result settles only that pending send and its visible Run indicator. `timeout` leaves
   the pending state intact for the existing `sessions.describe` and `chat.history` path.
4. The wait response never creates transcript content or a synthetic Tool result. The established history refresh
   continues to load durable messages from OpenClaw.

## Validation

- Focused tests cover exact request shape, strict result parsing, unavailable transport, timeout preservation,
  stale observation rejection, single-session application, and prevention of cross-Run settlement.
- `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:openclaw-docs`, and `git diff --check` passed.

## Unverified boundaries

- No live Gateway disconnect and reconnect was performed for this change.
- macOS, Windows, CentOS, and Ubuntu behavior is not separately host-dependent here; each still needs target
  platform acceptance with a real Gateway.
