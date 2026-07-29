# Installation and Wizard Audit Hardening Spec

Date: 2026-07-29

## BUG-IW-01 - End-to-end setup cancellation

**Current:** only Node/Git register a cancellable Rust operation. OpenClaw npm
and Docker pull continue after the UI's cancel action.

**Target:** a shared setup operation coordinator owns Node, Git, OpenClaw, and
Docker pull. Every frontend invocation supplies a unique operation id. A cancel
request terminates and reaps an owned child tree before resolving.

**Acceptance:**

- [x] Node, Git, OpenClaw, and Docker pull register the initiating operation id.
- [x] OpenClaw cancellation stops npm and does not start a fallback registry.
- [x] Docker cancellation stops `docker pull` and joins output readers.
- [x] Cancellation waits for cleanup, compensates runtime/storage, then navigates.
- [x] A stale cancel id cannot affect a newer attempt.

## BUG-IW-02 - No Wizard answer replay

**Current:** all accepted answers are retained and replayed for Back/Retry.

**Target:** the client stores only the opaque session id and current diagnostic
step. Page Back pauses the session; retry resumes a live session or starts a
fresh official session after terminal failure.

**Acceptance:**

- [x] No accepted answer history exists in the client.
- [x] A sensitive answer is not retained after the request settles.
- [x] The Wizard UI does not claim a native previous-step action.
- [x] Returning to configuration resumes the same live session.
- [x] Terminal failure recovery starts fresh without RPC answer replay.

## BUG-IW-03 - Cached Docker installation validity

**Current:** every selected Docker runtime validates as installed.

**Target:** check Docker's durable availability separately from daemon readiness.

**Acceptance:**

- [x] Missing or unsupported Docker returns setup validation `false`.
- [x] A running daemon without the selected OpenClaw image returns `false`.
- [x] A present CLI with a stopped daemon remains valid for cold-start recovery.
- [x] Native validation remains independent from Gateway process readiness.

## BUG-IW-04 - Installed Wizard protocol contract

**Current:** types/tests/UI accept fields forbidden by OpenClaw 2026.7.1.

**Target:** the boundary accepts only the installed schema and message-owned
authorization presentation.

**Acceptance:**

- [x] Step types, format, executor, options and optional fields match 2026.7.1.
- [x] Unknown types/properties fail validation instead of entering the renderer.
- [x] `externalUrl`, `deviceCode`, arbitrary metadata and their UI are removed.
- [x] URL and QR message handling continues to work from official note text.
- [x] Cancellation tests reflect the installed handler, not a hypothetical lock.

## BUG-IW-05 - Setup responsibility boundaries

**Current:** the root hook mixes operation ownership with all setup stages.

**Target:** a typed operation coordinator is the single owner of operation ids,
cancellation requests, completion fencing and stale-run protection. The public
hook composes focused runtime/install/Wizard modules.

**Acceptance:**

- [x] No second active-operation ref or cancellation implementation exists.
- [x] Installation stage functions consume the shared coordinator API.
- [x] The root hook is materially smaller and no new setup file becomes a
      similarly broad replacement.
- [x] Module-boundary, TypeScript and behavioral tests remain green.

## Verification boundary

Acceptance above is backed by local source-contract, behavior, TypeScript, Rust,
build, and package validation. Windows UAC/NSIS/Docker Desktop/Credential Manager
and macOS signing/notarization/updater delivery still require their target
platform or release infrastructure; they are not implied by these checkmarks.
