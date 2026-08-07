# OpenClaw Agent Identity Projection

Date: 2026-08-04

## Evidence

- The current official [OpenClaw gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  documents `agent.identity.get` as the effective assistant identity lookup for an agent or session.
- The current official source declares `agentId`, optional `name`, `avatar`, `avatarSource`, `avatarStatus`,
  `avatarReason`, and `emoji`; the installed Gateway schema and handler expose the same contract.
- The current official [Control UI documentation](https://github.com/openclaw/openclaw/blob/main/docs/web/control-ui.md)
  requires authenticated avatar retrieval and converts avatar data into local blob URLs. A raw relative path or
  remote URL cannot be used directly by the JunQi WebView without an equivalent credential-scoped media bridge.

## Finding

`MessageBubble` and `TypingIndicator` previously derived the assistant id from the session-key string and then
looked up a configured `agents.list` entry. That cannot represent the effective identity resolved by OpenClaw
from the targeted session and its agent identity configuration.

## Change

1. Add a fenced `agent.identity.get` client with strict response decoding and a structured unavailable state.
2. Cache successful identity reads only within the current attested Gateway connection and session key.
3. Reuse the resolved name and configured marker in the assistant avatar, response footer, QuickChat, and typing
   indicator. When the official read is unavailable, show only the localized generic assistant label; do not derive
   a name or marker from a session key or `agents.list` entry.
4. Decode official avatar metadata but do not render the returned URL until JunQi has an authenticated,
   credential-scoped avatar media bridge equivalent to the upstream contract.

## Visual treatment follow-up (2026-08-07)

- The assistant avatar keeps the OpenClaw-resolved name, marker, and fallback letter/icon behavior unchanged.
- The previous saturated primary-to-deep-primary gradient and matching ring made the avatar read as a status badge
  beside the low-opacity assistant bubble.
- The avatar now uses the semantic elevated surface and border tokens, with a restrained primary inner highlight and
  primary foreground. This keeps identity legible without inventing an avatar image or a per-agent color system.
- The same `AssistantResponseAvatar` is shared by settled replies and the typing indicator, so both states retain one
  visual treatment.

## Non-goals

- No new OpenClaw identity RPC, configuration mutation, local identity persistence, or avatar download path.
- No token, credential, workspace path, or avatar source is added to logs or persistent frontend storage.
- No claim that a configured marker is a downloaded avatar image.
- No OpenClaw identity fields, avatar transport, or message layout behavior changes in the visual follow-up.

## Validation

- Focused Gateway-client and presentation regression tests cover request shape, strict decode, unavailable-method
  behavior, connection fencing, and the generic fallback.
- `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:openclaw-docs`, and `git diff --check` passed.

## Unverified boundaries

- No real Gateway identity response or authenticated avatar transport was tested in this change.
- macOS, Windows, CentOS, and Ubuntu visual acceptance remains pending because this change does not alter a native
  host API or platform-specific runtime.
- Automated checks can verify the existing identity projection contract, but final contrast and spacing judgment for
  the new avatar surface still requires desktop visual acceptance in light and dark themes.
