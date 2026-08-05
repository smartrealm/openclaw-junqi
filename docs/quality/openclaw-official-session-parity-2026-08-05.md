# Official OpenClaw Session Parity

## Evidence

- Official source inspected: `/Users/wei/DevTool/project/mine/gui/openclaw`, commit `1e3880352e6`, package version `2026.7.2`.
- Runtime package currently locked by this repository: `openclaw@2026.7.1-2`.
- Protocol contracts inspected in the official `packages/gateway-protocol/src/schema/sessions.ts` and `src/gateway/methods/core-descriptors.ts`.

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

The official 2026.7.2 source also contains remote session-workspace read/write, reveal, and viewer-presence APIs. The current bundled runtime is 2026.7.1-2 and does not advertise those APIs. They are not exposed as functioning UI in this change because doing so would invent a contract for the installed runtime. They remain a follow-up only after the bundled/runtime upgrade advertises and validates those methods.

## Verification

- `pnpm exec tsc --noEmit`
- `node --import ./test-setup.ts --import tsx --test src/services/gateway/sessionCapabilities.test.ts src/services/gateway/SessionTranscriptHistoryClient.test.ts`
- `git diff --check`

The change has not been exercised against a live 2026.7.2 Gateway in this repository. Live permissions, transcript mutation results, and server-emitted invalidation events remain target-runtime verification items.
