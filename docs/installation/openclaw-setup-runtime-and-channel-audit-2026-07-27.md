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
- OpenClaw official onboarding and Gateway protocol references:
  `https://docs.openclaw.ai/reference/wizard` and
  `https://docs.openclaw.ai/gateway/protocol` (checked 2026-07-27).

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

### BUG-CRA-07 - Wizard channels appear unbound and the implicit main agent cannot be selected

**Severity:** P1

The official onboarding Wizard writes channel credentials but does not write
root `bindings` for the implicit default agent. OpenClaw 2026.7.1 routes an
unmatched channel/account to `resolveDefaultAgentId(cfg)`, which is the implicit
`main` agent when `agents.list` is absent. JunQi instead treated missing root
bindings as unusable and built its binding selector only from `agents.list`, so
a fresh Windows setup showed an empty agent list and an alarming "unbound"
state even though Runtime routing remained valid.

**Target:** mirror the selected Runtime default-agent semantics in the channel
projection: expose implicit `main` when no explicit list exists, identify the
Runtime-selected default when a list does exist, describe an empty root binding
as "use Runtime default" rather than "no target", and keep explicit root
bindings as optional route overrides.

### BUG-ONB-49 - Wizard reconnect can remain pending forever

**Severity:** P1

The 2026-07-27 packaged run completed the official Gateway handoff, and the
official CLI subsequently reported a healthy, admin-capable RPC connection.
The renderer nevertheless remained on `Connecting to the official OpenClaw
wizard`. The Gateway log recorded `wizard not found` for the process-local
session, followed by a successful service restart, but no replacement
`wizard.start` or resume request reached the new process.

Cross-file verification found three interacting gaps:

- `OpenClawWizardClient.resume()` uses an unbounded `wizard.next` request even
  though the official protocol exposes `wizard.status` for session liveness.
- The privileged-request timeout begins only after the request reaches the head
  of its serialized admin lane, so a request queued behind an unbounded Wizard
  operation has no effective deadline.
- `waitForGatewayConnection()` disconnects an already verified connection before
  every Wizard operation, creating an avoidable identity transition and leaving
  the connecting screen with no phase-specific diagnostic.

**Impact:** a stale process-local session or interrupted Gateway handoff can
leave first-run setup permanently disabled even though OpenClaw is healthy. A
retry cannot be offered because `wizardSubmitting` never settles, and the setup
log contains no record of whether it is waiting for Gateway transport, session
status, or a new Wizard step.

**Target:** use the official `wizard.status` RPC before resuming a persisted
session, apply finite transport budgets to resume/interactive calls, make the
privileged budget cover queue wait as well as socket execution, preserve an
already verified Gateway connection, and expose each connection phase in both
the setup UI and diagnostics. A timed-out answer must retain the opaque session
id so Retry can resume without replaying secrets or accepted answers.

### BUG-ONB-50 - The channel primer note is presented as a scan step

**Severity:** P1

Verified on 2026-07-29 against installed `openclaw@2026.7.1-2`.
`noteChannelPrimer()` (`dist/onboard-channels-BsIvPxyr.js`) emits a plain
explanatory note titled `How channels work`. Its body carries the pairing docs
link and then every channel's capability blurb, three of which only *name* a QR
login (`Personal WeChat messaging via QR-code login.`,
`通过二维码登录接入 Zalo 个人账号。`, and the ZaloClawBot blurb).

JunQi matched the bare noun with `/scan|扫码|二维码|qr\b/i` over the whole
message, so this primer was reclassified as an authorization step. The URL
extractor then took the message's *first* URL — the docs link — and rendered
`https://docs.openclaw.ai/channels/pairing` as a scannable code. The primary
action was relabelled `我已完成授权，继续`, and submitting it also attempted a
QR authorization continuation. Because the blurbs are catalog-driven, this
occurred on every run that reached channel selection, before any channel was
chosen.

**Target:** require an explicit scan verb rather than the bare noun, so a note
that merely names QR login stays a note. Cross-checked against every channel
plugin that authorizes by QR, all of which phrase the real prompt as an action:
`@tencent-weixin/openclaw-weixin` 2.4.6 (`用手机微信扫描以下二维码，以继续连接：`),
`@openclaw/whatsapp` 2026.7.1 (`…then scan this QR:`), `@openclaw/zalouser`
2026.7.1 (`QR already active. Scan it with the Zalo app.`), `@openclaw/feishu`
2026.7.1 via `wizard.feishu.scanQr`, and
`@dingtalk-real-ai/dingtalk-connector` 0.8.24, whose single note combines
`Scan with DingTalk to configure your bot (请使用钉钉扫码，配置机器人):`, the
device `Authorization URL:`, and the `Waiting for authorization result...`
polling cue that drives BUG-ONB-41/42 hand-off. Plugin expiry and failure
notices (`二维码已过期，请重新生成。`, `QR login was declined on the phone.`)
carry no verb and correctly stop starting a scan presentation.

**Unverified boundary:** channel plugins were read from their published npm
tarballs, not from a live wizard run. A future plugin whose scan prompt omits
any scan verb would need the structured `externalUrl` field instead; that field
is already preferred when present.

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
- Behavioral tests pinning the channel primer note as a non-scan step while
  every QR-authorizing channel plugin's verbatim scan prompt still resolves,
  including the DingTalk note that must keep driving URL extraction and the
  polling hand-off.
- Source-contract tests for Gateway-owned progress polling and QR persistence.
- Source-contract tests for backend cancellation reachability, staged-runtime
  compensation, and dedicated prerequisite recovery routes.
- Behavioral tests for official `wizard.status` recovery, finite Wizard
  budgets, and privileged queue deadlines that begin when the caller queues.
- Source-contract tests that a healthy Wizard entry does not force a Gateway
  reconnect and that connection phases are observable.
- Behavioral tests that a fresh Wizard config exposes implicit `main`, that an
  explicit Runtime default is marked correctly, and that a healthy account
  without an override binding remains routable.
- Full frontend test suite and production Tauri packaging.

## 2026-07-29 Windows channel-binding follow-up

BUG-CRA-07 was reproduced from the post-Wizard Windows symptom and verified
against installed OpenClaw 2026.7.1-2 sources:
`resolveAgentRoute()` falls through to `resolveDefaultAgentId()`, while an empty
`agents.list` resolves to `main`. JunQi's previous `config.agents.list ?? []`
selector therefore omitted the valid implicit agent and its readiness model
contradicted Runtime behavior. The channel projection and selectors now follow
the Runtime fallback without writing a speculative binding.

## 2026-07-27 Validation

The final integrated worktree passed 1,653 frontend tests, 217 script tests,
module boundaries, TypeScript, and 624 Rust library tests.

The macOS ARM64 application, DMG, and updater archive were produced. The local
candidate was launched from the generated application bundle as PID 62756; a
desktop capture confirmed it rendered the dashboard instead of remaining on
the Wizard connection screen, while the official OpenClaw CLI reported a
healthy admin-capable RPC connection. Trusted updater signing was not attempted:
this workstation has the public updater key but intentionally does not have the
release private key, so the Tauri command exited after bundle creation when it
reached updater signing.
