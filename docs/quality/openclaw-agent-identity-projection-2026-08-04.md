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
   indicator. Existing configured-agent presentation remains only as visual continuity when the official read is
   unavailable; it neither creates local identity state nor reports an effective identity.
4. Decode official avatar metadata but do not render the returned URL until JunQi has an authenticated,
   credential-scoped avatar media bridge equivalent to the upstream contract.

## Non-goals

- No new OpenClaw identity RPC, configuration mutation, local identity persistence, or avatar download path.
- No token, credential, workspace path, or avatar source is added to logs or persistent frontend storage.
- No claim that a configured marker is a downloaded avatar image.

## Validation

- Focused Gateway-client regression tests cover request shape, strict decode, unavailable-method behavior, and
  connection fencing.
- `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:openclaw-docs`, and `git diff --check` passed.

## Unverified boundaries

- No real Gateway identity response or authenticated avatar transport was tested in this change.
- macOS, Windows, CentOS, and Ubuntu visual acceptance remains pending because this change does not alter a native
  host API or platform-specific runtime.
