# OpenClaw Agent Wait Run Recovery Plan

Date: 2026-08-04

- [x] Verify installed OpenClaw schema and handler semantics for the exact `agent.wait` Run lookup.
- [x] Trace uncertain-send identity from dispatch through chat-state reconciliation.
- [x] Add a connection-fenced read-only client and observation-fenced single-flight coordinator.
- [x] Settle only exact terminal uncertain sends while retaining native history as transcript authority.
- [x] Add client, coordinator, and chat-state regression coverage.
- [x] Run complete frontend validation, inspect the final diff, scan modified files, and commit with a Chinese message.

## File scope

- `src/services/gateway/OpenClawAgentWaitClient.ts`
- `src/services/gateway/OpenClawPendingRunWaitReconciler.ts`
- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/index.ts`
- related tests and quality records
