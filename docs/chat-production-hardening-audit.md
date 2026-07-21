# Chat Production Hardening Audit

Date: 2026-07-21

Scope: JunQi Desktop chat composition, Gateway send lifecycle, transcript history, attachments, voice, artifacts, and session settings against the bundled OpenClaw `2026.7.1` protocol.

## Findings

| ID | Severity | Failure mode | Required invariant |
| --- | --- | --- | --- |
| CHAT-01 | P0 | Model-produced HTML/React/SVG executes JavaScript in an inline iframe | Generated artifacts are source-first and an inline preview never grants script execution |
| CHAT-02 | P1 | A rejected `chat.send` leaves typing active, an optimistic message marked as sent, or a full offline queue silently evicts prior work | Every send ends in an explicit `sent`, `queued`, or `failed` state; failure clears typing; queue overflow rejects without eviction |
| CHAT-03 | P1 | Attachment draft state follows the component instead of the session | Text and prepared attachments are isolated by the captured session key |
| CHAT-04 | P1 | Non-image files are reduced to paths or a local staging stub | Files use the official `chat.send.attachments` payload and survive the local queue |
| CHAT-05 | P1 | Forced history refreshes are dropped and canonical history can erase optimistic messages | A forced refresh requested during an in-flight load runs afterwards; unmatched local tail state is retained |
| CHAT-06 | P1 | History pagination uses message ids as an HTTP cursor | Pagination uses OpenClaw `chat.history.offset`, `nextOffset`, and `hasMore` |
| CHAT-07 | P1 | Persona UI calls unsupported `sessions.patch.systemPrompt` | Persona is represented as a visible, user-editable draft instruction; JunQi never claims a hidden system prompt was applied |
| CHAT-08 | P1 | JunQi injects private desktop metadata into the first user message | `chat.send.message` is exactly the user-authored text |
| CHAT-09 | P1 | Voice fallback creates a fake assistant message or sends truncated base64 as text | Recorded audio is an official attachment owned by a user message |
| CHAT-10 | P2 | A send can overtake a preceding session model/thinking mutation | Session mutations are serialized and sends wait for the mutation lane already pending for that session |
| CHAT-11 | P2 | Truncated transcript messages cannot be expanded | Normalization preserves OpenClaw truncation metadata and UI can call `chat.message.get` |

## Protocol evidence

- `chat.send` accepts `attachments` and an `idempotencyKey`.
- `chat.history` in OpenClaw 2026.7.1 accepts `offset` and returns pagination metadata.
- persisted user idempotency keys can be suffixed with `:user`.
- truncated history entries expose `__openclaw.truncated`; the full entry is available through `chat.message.get`.
- `sessions.patch` does not define `systemPrompt` in the bundled protocol schema.

## Release gate

The repair is complete only when each finding has a regression test, TypeScript and boundary checks pass, the production build succeeds, and the chat page is smoke-tested in a running development build.

## Verification result

- Focused Chat hardening suite: passed.
- Complete application and release-script suites: passed.
- TypeScript, module boundaries, production build, and diff checks: passed.
- Development server and application entry module: HTTP 200 at `http://127.0.0.1:5174/`.
- Screenshot and interactive browser verification: unavailable because this environment exposed no in-app browser runtime.
