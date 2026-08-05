# OpenClaw Official Session Parity Specification

## Goal

Expose official transcript history controls only when the connected Gateway advertises their exact protocol methods.

## Acceptance Criteria

1. A disconnected Gateway or an empty `features.methods` list exposes no new transcript-history controls.
2. `sessions.fork` sends `{ sessionKey, entryId, agentId? }`, creates no optimistic local session, and opens authoritative history only after Gateway confirms the created session.
3. `sessions.rewind` and `sessions.branches.switch` use the privileged lane, run through the session mutation coordinator, and reload the authoritative transcript after confirmation.
4. `sessions.branches.list` validates every returned branch before rendering it.
5. Method-not-found is distinct from authorization, pairing, transport, and response-validation failures; none are converted into local transcript mutations.
6. All new visible text exists in Simplified Chinese, Traditional Chinese, and English locale catalogs.
