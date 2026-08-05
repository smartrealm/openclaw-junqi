# OpenClaw Official Session Parity Plan

1. Capture the authenticated hello observation on the Gateway connection and expose it as a subscription.
2. Map exact advertised methods into a session capability value without version checks.
3. Isolate branch, fork, and rewind request construction and response validation in one protocol client.
4. Connect controls through hooks and existing message/session surfaces.
5. Add regression tests for capability gating, payload shape, response validation, request-lane selection, and unsupported-protocol distinction.
6. Run static checks, focused tests, boundary checks, and production build.
