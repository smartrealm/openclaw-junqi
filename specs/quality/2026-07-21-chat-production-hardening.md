# Chat Production Hardening Specification

## Send transaction

All immediate user-originated sends go through one coordinator. The coordinator creates or updates the optimistic user message, waits for pending session mutations, invokes `chat.send`, and commits exactly one terminal delivery state. A rejected call records a retryable error and releases typing state. A queued item is removed only after Gateway acknowledgement; attachments remain attached during retry. A full offline transport queue rejects the new send explicitly and never evicts a previously acknowledged queued message.

## Attachment transaction

Prepared attachment data is stored per session. File reads are binary-safe and bounded by count, per-file size, and total size. Images, audio, and regular files use the same OpenClaw attachment contract. Switching tabs during preparation or sending can only mutate the captured session's draft.

## Transcript transaction

Canonical transcript messages replace matching optimistic messages by native id, normalized client id, or conservative fingerprint. OpenClaw's `:user` persistence suffix is normalized. A canonical refresh retains only unmatched local delivery/streaming tail entries, never arbitrary stale history. Forced refresh calls coalesce into one follow-up request. Older pages use `chat.history.offset`.

## Trust boundary

Model output is untrusted. Artifact cards start on source view. Static HTML/SVG preview is opt-in and uses an empty iframe sandbox; React source is never executed in-process. Tauri ships with an explicit CSP. JunQi does not inject hidden content into user messages.

## Capability boundary

Unsupported per-session system prompts are not sent to OpenClaw. Selecting a persona creates a visible draft instruction for user review. Session model and thinking changes use the supported `sessions.patch` fields, share a per-session mutation lane with send ordering, and use a one-operation `operator.admin` connection. Label changes remain on the daily `operator.write` connection. A rejected change preserves the previous UI value and surfaces an explicit error.

The session projection combines `sessions.list.modelProvider` and `model` into the same canonical `provider/model` id used by `models.list`. The active model row is visibly marked and disabled so selecting it cannot enqueue a redundant privileged mutation.

Session runtime controls live in the composer footer, where they describe the next turn. The trigger keeps the committed model and thinking labels stable while a mutation is pending. Provider/model and thinking changes are staged in one popover and applied only after explicit confirmation; switching sessions closes an open draft so settings cannot leak across sessions. The top context bar must not duplicate these controls.

The session key captured when Save starts remains the owner of every successful result. Model and thinking metadata update that session row; active title state and manual override state change only when the initiating session is still active. A tab switch during the privileged request cannot project the old session's settings onto the new session.

## Composer ownership

`MessageInput` is a composition boundary, not the owner of every composer workflow. Queue editing, attachment preparation and overlays, suggestions, voice lifecycle, menu lifecycle, interruption, send transactions, and session runtime settings have separate components or hooks. Pure model grouping, suggestion filtering, and artifact capability rules remain framework-independent and directly testable.

## Artifact actions

A message-level preview action is capability-driven. It is shown only when the message contains static HTML or SVG that the existing empty-sandbox iframe can display. Clicking it switches the artifact card to preview. React and generic code artifacts never expose this action and are never executed in-process.

## Full-message recovery

History normalization preserves `__openclaw.seq`, `truncated`, and `reason`. A truncated message exposes an explicit load action that calls `chat.message.get` and atomically replaces the displayed payload while retaining the local render identity.

## User-message recovery actions

- A failed local user message edits in its current bubble; content is never copied into the composer.
- Saving an edit retries through the shared send coordinator with the original client identity, session identity, and attachment payload.
- Failed or cancelled messages that have no native transcript identity expose a delete icon and require confirmation.
- A pending, sent, or native transcript message cannot be edited or deleted locally because OpenClaw 2026.7.1 exposes no authoritative per-message mutation RPC.
- Canonical history refresh must never restore a UI-only mutation presented as durable state.
