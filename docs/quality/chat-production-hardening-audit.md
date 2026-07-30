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
| CHAT-15 | P1 | User-message edit/delete controls either move content into the composer or mutate only the local array, then revert on history refresh | Failed messages without a native transcript identity edit in their existing bubble and can be deleted; durable history never exposes a fake mutation |
| CHAT-16 | P1 | Model and thinking selectors call `sessions.patch` over the daily read/write socket and silently fail | Runtime overrides use the transient `operator.admin` lane; label changes retain `operator.write`; failures are visible and do not alter local state |
| CHAT-17 | P2 | `sessions.list.model` is compared directly with the canonical `models.list` id, so the active row has no marker and can be selected again | Combine `modelProvider` and `model`; mark and disable the matching row |
| CHAT-18 | P2 | Model/thinking controls either appear twice or are detached from agent/workspace context in the composer, and clearing the committed value while saving causes visible layout flicker | Keep one staged runtime control beside workspace in the top context bar; preserve committed labels through pending work and close drafts on session changes |
| CHAT-19 | P2 | Conversation artifacts have an inline sandbox preview but no message-level discovery action | Expose a preview icon only for static HTML/SVG and route it to the existing sandbox preview |
| CHAT-20 | P2 | `MessageInput.tsx` owns queue, attachment, completion, voice, send, and runtime UI in one 1576-line component | Keep the component as an orchestrator and isolate each workflow behind a focused component, hook, and pure domain helper |

## Protocol evidence

- `chat.send` accepts `attachments` and an `idempotencyKey`.
- `chat.history` in OpenClaw 2026.7.1 accepts `offset` and returns pagination metadata.
- persisted user idempotency keys can be suffixed with `:user`.
- truncated history entries expose `__openclaw.truncated`; the full entry is available through `chat.message.get`.
- `sessions.patch` does not define `systemPrompt` in the bundled protocol schema.
- OpenClaw 2026.7.1-2 authorizes `sessions.patch` per field: `model` and `thinkingLevel` require `operator.admin`, while `label` is allowed with `operator.write`.
- OpenClaw 2026.7.1 registers `chat.history`, `chat.message.get`, `chat.abort`, `chat.send`, and `chat.inject`; it does not register a per-message edit or delete method.

## User-message recovery boundary

The previous inline implementation truncated the local message array and called `chat.send` again. It did not mutate the OpenClaw transcript, so a canonical refresh restored the original message. The later “Edit in composer” replacement was truthful but did not match the bubble interaction.

The supported recovery surface is now capability-driven. A failed local user message with no `nativeMessageId` can be edited inside the same bubble and retried with its original client identity and complete attachment payload. Failed or cancelled local messages can be deleted after confirmation. Sent and otherwise durable messages expose neither operation because OpenClaw provides no authoritative mutation contract.

## Release gate

The repair is complete only when each finding has a regression test, TypeScript and boundary checks pass, the production build succeeds, and the chat page is smoke-tested in a running development build.

## Verification result

- Focused Chat hardening suite: passed.
- Complete application and release-script suites: passed.
- TypeScript, module boundaries, production build, and diff checks: passed.
- Development server and application entry module: HTTP 200 at `http://localhost:5173/`.
- Screenshot and interactive browser verification: unavailable because this environment exposed no in-app browser runtime.

## Session model switch verification (2026-07-29)

- Reproduced the installed OpenClaw `2026.7.1-2` permission contract: changing `model` or `thinkingLevel` requires `operator.admin`; changing `label` requires `operator.write`.
- Confirmed through a read-only `sessions.list` call that the Gateway returns `modelProvider` and a provider-local `model`; JunQi now projects both fields into the canonical model id used by the selector.
- Focused regression tests, the complete test suite, TypeScript, module boundaries, the production build, and diff checks passed.
- A real `sessions.patch` mutation through an approved `operator.admin` pairing remains unverified because it would alter the active user session. No permission or mutation success is inferred from the read-only check.

## Composer runtime and artifact action verification (2026-07-29)

- Replaced the former independent model/thinking selectors with one control derived from the live Gateway model catalog; the control is owned by the top context bar beside workspace rather than the message composer.
- Provider, model, and thinking selections remain draft state until Save. The committed trigger label remains mounted while the privileged mutation is pending, preventing the previous null-placeholder flicker.
- Split the former 1576-line `MessageInput` into queue, attachment/overlay, input surface, suggestions, menu lifecycle, interruption, voice, send, and session-runtime modules. The composition file is 137 lines; the largest focused controller is 345 lines.
- Session runtime commits retain the initiating session key. Inactive-session model/thinking results update that session row without overwriting the newly active session's title state.
- Added a message preview action gated by the pure HTML/SVG capability rule. It requests the existing empty-sandbox artifact preview and does not enable React execution.
- Focused composer/session/artifact/store regressions: 48/48 passed.
- Complete application and release-script suites: 223/223 passed.
- Module boundaries and TypeScript: passed across 607 checked files.
- Production build: passed in 12.28 seconds; no circular-chunk, oversized-chunk, or Vite warning was emitted.
- `git diff --check`: passed.
- Local HTTP smoke check: passed at `http://localhost:5173/`.
- Interactive screenshot verification remains unavailable because the browser runtime exposed no browser instance. A real `operator.admin` mutation also remains intentionally unverified.

## Top context runtime correction verification (2026-07-30)

- Restored the single session runtime control to the top context bar immediately after workspace and removed its composer footer owner.
- The existing staged provider/model/thinking editor, current-model disabled state, default restoration, session-key fencing, and stable pending label remain shared rather than reimplemented.
- Focused composer and session-runtime regressions: 8/8 passed, including the pre-fix failing ownership and popover-direction contract.
- Complete application tests: 1891/1891 passed; release-script tests: 224/224 passed.
- TypeScript, module boundaries, production build, `git diff --check`, and local HTTP smoke check passed.
- The production bundle and local resource server were verified, but the updated Tauri window was not exercised because an installed JunQi process already owned the application single-instance lock. These checks are not presented as desktop UI acceptance. A real privileged model mutation also remains intentionally unverified.
