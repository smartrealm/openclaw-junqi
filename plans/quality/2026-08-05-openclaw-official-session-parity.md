# OpenClaw Official Session Parity Plan

1. Capture the authenticated hello observation on the Gateway connection and expose it as a subscription.
2. Map exact advertised methods into a session capability value without version checks.
3. Reuse the existing `OpenClawSessionBranchesClient` and `OpenClawSessionMessageCutClient` as the single protocol boundary for branch, fork, and rewind operations.
4. Connect controls through the existing message and unified session-toolbar surfaces.
5. Add regression tests for capability gating, payload shape, response validation, and request-lane selection.
6. Run static checks, focused tests, boundary checks, and production build.
