# Official OpenClaw Session Parity

## Evidence

- Official source inspected: [`openclaw/openclaw`](https://github.com/openclaw/openclaw), local official clone commit `1e3880352e6`.
- Protocol contracts inspected in the official `packages/gateway-protocol/src/schema/sessions.ts` and `src/gateway/methods/core-descriptors.ts`.
- Runtime eligibility is determined solely by the authenticated Gateway `features.methods` declaration. JunQi does not infer support from a package version, local installation, or an upstream revision.

## Current Behavior

JunQi already uses native OpenClaw session creation, organization, transcript subscriptions, preview, compaction checkpoints, reset, and deletion. The official source additionally exposes transcript-DAG methods: `sessions.branches.list`, `sessions.branches.switch`, `sessions.rewind`, and `sessions.fork`.

This change adds a strict transcript-history client and message-level controls for the latter methods. It also preserves the Gateway handshake's advertised method list for the lifetime of the authenticated socket. New controls are not rendered when the Gateway omits or does not advertise their methods. This avoids treating an older installed Gateway as compatible merely because a newer upstream source contains the method.

## Permission Model

- `sessions.branches.list` and `sessions.fork` use the ordinary authenticated request lane.
- `sessions.rewind` and `sessions.branches.switch` use the privileged request lane because the official descriptor requires `operator.admin`.
- All transcript mutations use the existing per-session mutation coordinator.
- A method-not-found response is represented as a typed unsupported-protocol error. Authorization and transport errors remain intact and are not converted to local fallback behavior.

## UI Behavior

- Persisted user messages expose icon actions for fork and rewind only when the active Gateway explicitly advertises the corresponding RPC.
- Both destructive history mutations require confirmation and invalidate/reload the authoritative transcript after completion.
- The existing session-inspection surface lists branches and offers branch switching only when the official methods are advertised.
- Copy and preview controls remain separate message actions; no content is moved or generated client-side to simulate a Gateway transcript mutation.

## Deliberate Boundary

This change is limited to the official transcript-DAG methods. Existing file, workspace, viewer-presence, and abort integrations retain their own established protocol boundaries and are not inferred from this capability set.

## Verification

- `pnpm lint`
- `node --import ./test-setup.ts --import tsx --test src/services/gateway/sessionCapabilities.test.ts src/services/gateway/SessionTranscriptHistoryClient.test.ts src/services/gateway/gatewayCredentialSecurity.test.ts`
- `git diff --check`

The change has not been exercised against a live Gateway that advertises these methods in this repository. Live permissions, transcript mutation results, and server-emitted invalidation events remain target-runtime verification items.
