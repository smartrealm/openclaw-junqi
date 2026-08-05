# OpenClaw Agent Wait Run Recovery Specification

Date: 2026-08-04

## Current

JunQi keeps an uncertain `chat.send` pending until a fenced session snapshot and `chat.history` confirm or reject
it. This protects delivery but cannot read an already-recorded exact Gateway run outcome during transport loss.

## Target

- Only a locally recorded pending Run in the `uncertain` phase may query `agent.wait`.
- The request contains the exact pending `runId` and `timeoutMs: 0` through the attested connection fence.
- A response can settle the local Run only when its exact `runId` matches the current observation and its status is
  `ok` or `error`.
- `timeout`, including an upstream timeout outcome which is ambiguous in this lookup response, a missing method,
  an invalid response, a stale connection, or a changed observation must not settle the Run.
- `chat.history` remains the source for persisted user and assistant messages; no wait response becomes chat or
  Tool content.

## Acceptance

- [x] The read-only client sends no fields beyond the official `runId` and zero `timeoutMs` request.
- [x] Connection, response identity, status, and observation are all validated before local settlement.
- [x] A completed Run cannot settle a newer or different pending Run in the same session.
- [x] Timeouts and unavailable results preserve the existing history-reconciliation path.
- [x] Focused behavior tests, complete frontend tests, production build, OpenClaw documentation-link verification,
  TypeScript/module-boundary checks, and diff validation pass.

## Non-goals

- Adding a local retry queue, task protocol, Tool result, or transcript message.
- Replacing OpenClaw session and history reconciliation.
- Claiming live Gateway or target-platform acceptance without a real runtime test.
