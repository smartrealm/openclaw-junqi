# Setup Runtime and Channel Compatibility Specification

## BUG-ONB-39 - Docker detection states

**Acceptance**

- [x] Installed/running, installed/stopped, and not detected are distinct.
- [x] Re-detection stays on the result page and displays inline loading without
      a full-page route transition.
- [x] Back and Next cannot race an active environment probe.

## BUG-ONB-40 - Gateway finalizer handoff

**Acceptance**

- [x] JunQi re-reads the selected Gateway URL and credential after replacement.
- [x] A lost process-local Wizard session reconciles durable configuration and
      live model readiness instead of replaying secret answers.
- [x] Successful finalization no longer becomes a false connection timeout.

## BUG-ONB-41 - Channel-neutral Wizard and QR handling

**Acceptance**

- [x] Gateway/plugin titles, messages, option identities, and extra metadata are
      preserved without a DingTalk/Feishu allowlist.
- [x] Safe QR URLs work from either plain Wizard text or a structured URL field.
- [x] Only notes explicitly waiting for authorization status auto-advance into
      plugin-owned polling.
- [x] Standard compact terminal QR output is redrawn for locally managed Native
      and Docker Gateways without decoding or persisting the payload.
- [x] A remote/external Gateway that does not transport stdout shows the real
      limitation and a server-terminal/manual fallback.
- [x] Unknown future step types remain readable instead of invalidating the
      entire Wizard response.

## BUG-ONB-42 - QR URL continuation and polling

**Acceptance**

- [x] A QR flow starts only after an explicit user action.
- [x] An immediate confirm step that semantically asks to continue URL/QR
      authorization is answered once with its affirmative value.
- [x] Unrelated confirm steps are never auto-submitted.
- [x] The plugin's polling request remains in flight until it returns its own
      success or failure result.
- [x] The success note is displayed unchanged instead of being inferred from a
      channel-specific status endpoint.

## BUG-ONB-43 - Wizard Back semantics

**Acceptance**

- [x] The audit records that OpenClaw has no native Back RPC.
- [x] The current restart-and-replay implementation is not described as rollback.
- [ ] Product behavior is changed only after Exit versus pure-input replay is
      selected explicitly.

## BUG-ONB-44 - Empty setup logs

**Acceptance**

- [x] Environment and storage pages do not show an empty log action.
- [x] The shared action appears once at least one real diagnostic exists.
- [x] Installation progress retains its dedicated live console.
- [x] Empty logs cannot be copied.

## BUG-ONB-45 - Terminal acknowledgement recovery

**Acceptance**

- [x] A final `Done / Onboarding complete` note is distinguishable from a
      channel plugin's intermediate authorization-success note.
- [x] A connection timeout while acknowledging that terminal note reuses the
      existing selected-Gateway and live-model verification before Ready.
- [x] Non-terminal steps keep their original timeout and recovery behavior.
- [x] Channel plugin probe failures remain visible and are described as
      non-blocking; JunQi does not rewrite or suppress the provider result.

## BUG-ONB-46 - Gateway progress polling

**Acceptance**

- [x] `progress` steps owned by the Gateway are polled without an answer.
- [x] Each progress step id starts at most one client poll.
- [x] User-owned note/select/confirm steps are not auto-submitted by the
      progress handler.
- [x] A locally captured terminal QR remains visible while progress snapshots
      are being polled and clears when the flow reaches a non-progress step.

## BUG-ONB-47 - Cancellable installation

**Acceptance**

- [x] Every active install state exposes a cancellation action.
- [x] Cancellation invalidates the renderer run and reaches the scoped Rust
      dependency installer operation.
- [x] A staged runtime or storage transaction is compensated before navigation.
- [x] The normal Back single-flight guard cannot make cancellation unreachable.

## BUG-ONB-48 - Prerequisite recovery routing

**Acceptance**

- [x] Failed Node post-install verification reaches `node-missing`.
- [x] Failed Git post-install verification reaches `git-missing`.
- [x] Each dedicated screen retains its download guidance and retry action.
- [x] Non-prerequisite failures continue to use the generic error route.

## BUG-CRA-07 - Runtime default channel routing

**Current**

- Official onboarding can configure a channel without creating a root
  `bindings` override.
- JunQi treats that account as unbound and builds the binding selector from
  `agents.list` only, so a fresh Runtime with implicit `main` has no selectable
  agent.

**Target**

- Follow the selected Runtime's default-agent fallback and present root
  bindings as optional overrides.

**Acceptance**

- [x] A missing `agents.list` exposes the implicit `main` agent.
- [x] An explicit `agents.list[].default` entry is marked as Runtime default;
      otherwise the first configured entry is used.
- [x] A healthy account without a root binding is ready through Runtime default
      routing rather than reported as having no message target.
- [x] Existing explicit account/channel/peer/ACP bindings remain unchanged.

## BUG-ONB-49 - Bounded official Wizard recovery

**Current**

- A persisted session is resumed through `wizard.next` without first checking
  the official `wizard.status` endpoint.
- `wizard.next` and resume explicitly disable timeouts.
- A privileged request's timeout starts after earlier admin work finishes, so
  the connecting UI can wait forever in the serialized lane.
- Entering every Wizard operation reconnects an already healthy Gateway and the
  UI exposes only one repeated `Connecting` sentence.

**Target**

- Query `wizard.status({ sessionId })` with a finite budget before resuming.
- Use a short finite budget for status/resume and a longer finite budget for
  user-started external authorization without suppressing provider output.
- Start the privileged timeout when the request is queued and never dispatch a
  request whose total budget expired while waiting.
- Keep a verified Gateway connection intact and surface transport/session phase
  changes in the setup UI and diagnostic log.

**Acceptance**

- [x] A missing process-local session fails or recovers within a bounded time;
      it cannot leave `wizardSubmitting` true forever.
- [x] Resume calls `wizard.status` before the no-answer `wizard.next` request.
- [x] A request queued behind another admin operation times out from its enqueue
      time and is not dispatched later.
- [x] An interactive timeout retains the session id and Retry resumes the
      official session without replaying an answer.
- [x] A healthy Gateway is not deliberately disconnected at Wizard entry.
- [x] The visible activity and setup log distinguish Gateway connection,
      session inspection, and Wizard start/resume.
