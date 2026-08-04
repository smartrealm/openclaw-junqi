# OpenClaw Agent Identity Projection Specification

Date: 2026-08-04

## Current

Assistant presentation derives an agent id from a session key and uses `agents.list` data to choose a display
name and initial. This is not the effective assistant identity returned for a session by OpenClaw.

## Target

- A connected JunQi session requests `agent.identity.get` with the exact session key through the existing
  attested connection fence.
- The response is decoded only when it conforms to the official fields and avatar-status enum.
- The resolved name and marker appear consistently in normal chat, grouped responses, QuickChat, and the typing
  indicator.
- Successful reads are never reused after the attested Gateway connection changes.
- Avatar metadata is not rendered as an uncredentialed WebView image URL.

## Acceptance

- [x] The client sends only `sessionKey` for session identity lookups and preserves the exact fenced connection id.
- [x] Invalid response fields, a missing method, disconnect, and a changed connection do not produce a local
  effective identity.
- [x] Existing presentation is used only while no official identity is available; it does not write or mutate
  OpenClaw identity data.
- [x] Chat avatar, footer, QuickChat, and typing indicator share the same identity projection path.
- [x] Focused tests, lint, complete tests, production build, OpenClaw documentation-link verification, and diff
  validation pass.

## Non-goals

- Implementing the authenticated OpenClaw avatar HTTP transport in the desktop host.
- Editing identity configuration or storing OpenClaw identity independently in JunQi.
