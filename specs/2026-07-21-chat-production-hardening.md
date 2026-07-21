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

Unsupported per-session system prompts are not sent to OpenClaw. Selecting a persona creates a visible draft instruction for user review. Session model and thinking changes use the supported `sessions.patch` fields and share a per-session mutation lane with send ordering.

## Full-message recovery

History normalization preserves `__openclaw.seq`, `truncated`, and `reason`. A truncated message exposes an explicit load action that calls `chat.message.get` and atomically replaces the displayed payload while retaining the local render identity.
