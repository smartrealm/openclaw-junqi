# OpenClaw Official Session Parity Plan

1. Capture the authenticated hello observation on the Gateway connection and expose it as a subscription.
2. Map exact advertised methods into a session capability value without version checks.
3. Use one `SessionTranscriptHistoryClient` as the protocol boundary for branch, fork, and rewind operations.
4. Connect controls through hooks and existing message/session surfaces.
5. Add regression tests for capability gating, payload shape, response validation, request-lane selection, and unsupported-protocol distinction.
6. Keep the hello external-store subscription stable and publish only real observation changes; make repeated connection-status commits idempotent.
7. Run static checks, focused tests, boundary checks, and production build.
