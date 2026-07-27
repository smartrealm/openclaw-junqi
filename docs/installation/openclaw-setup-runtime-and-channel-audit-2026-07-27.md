# OpenClaw Setup Runtime and Channel Audit

Reviewed on 2026-07-27 against the installed OpenClaw 2026.7.1-2 Wizard
protocol, Gateway lifecycle, DingTalk 0.8.24 onboarding, Feishu scan-to-create
onboarding, and JunQi's Native/Docker setup paths.

Official source cross-checks:

- OpenClaw `openclaw/openclaw` at `91b1f9676f9e1274ab705aea0d1f4d9b194769ef`
  (2026.7.2): `src/wizard/session.ts`, Gateway Wizard handlers, and
  `extensions/feishu`.
- DingTalk `DingTalk-Real-AI/dingtalk-openclaw-connector` at
  `5e2b4d9356ee8f80c4617142d823d2ca7de0f3d9` (0.8.24).
- Installed OpenClaw 2026.7.1-2 distribution for version-specific behavior.

## Findings

### BUG-ONB-39 - Docker installation and daemon readiness are collapsed

**Severity:** P2

The environment review labels Docker as unavailable unless its daemon is
already running. Re-detection also leaves the prior result on screen and gives
no loading feedback.

**Target:** present installed/running, installed/stopped, and not detected as
separate states; keep rechecks on the stable result page, show inline progress,
and lock navigation while all environment facts refresh.

### BUG-ONB-40 - Official Gateway finalization invalidates the Wizard session

**Severity:** P1

The official finalizer writes the durable Gateway credential and replaces the
bootstrap process. Wizard sessions are process-local, so JunQi keeps a stale
credential and session and reports a connection timeout after Gateway is ready.

**Target:** resolve the new connection target and credentials, reconnect, then
reconcile durable onboarding/model state if the old Wizard session is gone.

### BUG-ONB-41 - QR channel behavior assumes one plugin presentation

**Severity:** P1

DingTalk returns an authorization URL in Wizard notes and starts polling only
after the waiting note is acknowledged. Feishu scan-to-create writes a compact
terminal QR to Gateway stdout instead. A URL-only or channel-specific client
therefore strands at least one official flow and can reject future plugin step
metadata.

**Target:** preserve complete Wizard steps, avoid provider allowlists,
acknowledge explicit authorization-polling notes, accept safe structured URLs,
and redraw standard terminal QR output when it is locally observable. Remote
Gateway output that is not transported remains an explicit limitation, with a
manual/server-terminal fallback shown to the user.

### BUG-ONB-42 - QR fallback confirmation prevents authorization polling

**Severity:** P1

Some channel plugins first report that terminal QR rendering failed, then wait
for a separate `Continue with URL authorization?` confirmation before emitting
the note that starts their polling loop. JunQi presents that protocol-only
confirmation as another user step. Scanning the first rendered URL therefore
cannot produce a completion update because the plugin has not started polling.

**Target:** after the user explicitly starts a QR URL flow, automatically accept
only the immediate, affirmative URL-authorization continuation step, then let
the plugin own polling and preserve its success or failure note unchanged. The
recognition must be based on step semantics rather than a channel allowlist.

### BUG-ONB-43 - OpenClaw Wizard back is a replay, not a native rollback

**Severity:** P2

OpenClaw exposes no `wizard.back` RPC. JunQi currently cancels the official
session, starts a new one, and replays accepted answers to simulate Back. This
cannot undo side effects already produced by authorization, plugin installation,
or service operations.

**Target:** treat the current behavior as restart-and-replay, not guaranteed
rollback. A separate UI decision is required before changing the action because
exiting configuration and replaying pure input steps have different semantics.

### BUG-ONB-44 - Static setup pages expose an empty log drawer

**Severity:** P2

The shared setup shell shows its generic log action on the environment and data
location stages even when no setup or Gateway event has produced a log entry.
Those pages already present their observable state in the main content, so an
empty drawer adds a dead interaction and suggests diagnostics were lost.

**Target:** show the generic log action only when at least one real log entry is
available. Installation keeps its dedicated live console, while inline status
and Wizard errors remain visible without requiring a drawer.

### BUG-ONB-45 - Final Wizard acknowledgement reports a false timeout

**Severity:** P1

The official Wizard can show its terminal `Done / Onboarding complete` note and
restart the Gateway before JunQi acknowledges that note. JunQi waits for the
old WebSocket connection before every answer, so the already completed flow is
left on the terminal note with a contradictory connection-timeout error.

**Target:** recognize only provider-neutral terminal Wizard notes, then recover
from a lost final acknowledgement through the selected Gateway identity check
and live model probe. Channel authorization success notes must not be mistaken
for completion. A channel plugin's own connection-test failure remains visible
but is identified as a non-blocking plugin probe rather than an installation
failure.

### BUG-ONB-46 - Gateway-owned progress is treated as user input

**Severity:** P1

OpenClaw 2026.7.2 emits `progress` steps with `executor: "gateway"`; its session
implementation explicitly allows clients to poll those steps without an
answer. Feishu scan-to-create emits a QR to Gateway stdout, starts a progress
step, then polls until success, denial, expiry, or timeout. Treating that
progress snapshot as a normal Next button can stall the plugin and clears the
locally captured QR exactly when it is needed.

**Target:** automatically poll every Gateway-owned progress step once per step
id, never invent an answer, and retain local QR capture through consecutive
progress snapshots. Non-progress plugin prompts remain entirely plugin-owned.

### BUG-ONB-47 - Installation has no reachable cancellation action

**Severity:** P1

The Rust installer already supports operation-scoped cancellation, but the
`checking` and `install-*` screens expose only a disabled progress action. A
slow or stalled dependency install therefore requires terminating JunQi.

**Target:** route installation states through one `cancel-install` back policy,
cancel the active backend operation, compensate the staged runtime selection,
then return to the last user-selected setup screen.

### BUG-ONB-48 - Missing prerequisite screens are unreachable

**Severity:** P2

Git and Node recovery screens, translations, and retry actions exist, but
post-install verification failures are sent to the generic retry-only error
screen. Retrying cannot resolve a prerequisite that still is not installed.

**Target:** classify missing Git/Node as prerequisite failures and route them to
their existing download/instruction screens without collapsing other failures.

## Validation Contract

- TypeScript interface validation and complete locale JSON parsing.
- Per-bug source contracts for Docker review, Gateway handoff, and vendor-neutral
  Wizard presentation.
- Behavioral tests for safe QR URLs, future Wizard step types, and terminal QR
  extraction.
- Behavioral tests for a user-started QR flow crossing one protocol-only URL
  continuation before plugin polling begins.
- Behavioral tests that distinguish the official terminal note from an
  intermediate channel success note and recover only after durable setup exists.
- Source-contract tests for Gateway-owned progress polling and QR persistence.
- Source-contract tests for backend cancellation reachability, staged-runtime
  compensation, and dedicated prerequisite recovery routes.
- Full frontend test suite and production Tauri packaging.

## 2026-07-27 Validation

The final integrated worktree passed the full frontend/scripts suite, module
boundaries, TypeScript, and 622 Rust library tests. The macOS ARM64 DMG was
built and launched from its mounted image; a composited screen-region capture
confirmed the onboarding UI rendered correctly.
