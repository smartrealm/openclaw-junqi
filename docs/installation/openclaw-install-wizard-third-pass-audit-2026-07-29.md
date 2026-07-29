# OpenClaw Installation and Wizard Third-Pass Audit

Date: 2026-07-29

## Scope and authority

This pass audits the current `48f70cf` setup chain from the cached setup marker
through runtime selection, Native/OpenClaw installation, Docker image setup,
Gateway handoff, official Wizard RPC, and final dashboard entry.

The external contract is the repository's installed `openclaw@2026.7.1`, not an
upstream branch or a future release. The authoritative local evidence is:

- `node_modules/.pnpm/openclaw@2026.7.1/node_modules/openclaw/dist/schema-BuOFpc7K.js`
- `node_modules/.pnpm/openclaw@2026.7.1/node_modules/openclaw/dist/wizard-Cl5NHpYn.js`
- `node_modules/.pnpm/openclaw@2026.7.1/node_modules/openclaw/dist/session-Db7bzmh4.js`
- `node_modules/.pnpm/openclaw@2026.7.1/node_modules/openclaw/dist/setup-D5luTRzX.js`
- `node_modules/.pnpm/openclaw@2026.7.1/node_modules/openclaw/docs/reference/wizard.md`

The installed documentation says RPC clients render official steps without
reimplementing onboarding logic. The installed schema permits only
`note/select/text/confirm/multiselect/progress/action` and has
`additionalProperties: false`.

## Verified findings

### BUG-IW-01 - Cancel installation does not cancel OpenClaw npm or Docker pull

**Severity:** P1

`cancelSetupRun` invalidates the renderer run and invokes
`cancel_dependency_install`, but the Rust coordinator registers only Node.js and
Git operations. `install_openclaw`, `reinstall_openclaw`,
`relocate_openclaw`, and `pull_openclaw_image` accept no operation id. Their npm
and Docker children therefore continue until exit or timeout while the UI waits
for `activeSetupOperation.completion`.

The existing BUG-ONB-47 acceptance is too broad: its source-matching test proves
that a cancel button and a Node/Git coordinator exist, not that every active
install process observes cancellation. OpenClaw npm owns a 30-minute deadline,
so the false cancellation can remain blocked for the longest setup phase.

**Target:** one operation-scoped cancellation authority covers Node, Git,
OpenClaw npm, and Docker pull. Cancellation must terminate and reap the owned
process tree before the operation resolves and before runtime compensation or
navigation proceeds.

### BUG-IW-02 - Wizard Back/Retry replays secrets and irreversible effects

**Severity:** P1

`OpenClawWizardClient` stores every accepted answer in `history`, including
steps marked `sensitive`, then implements Back and failed-session Retry by
cancelling the official session, starting a new session, and resubmitting those
answers.

The installed OpenClaw navigator deliberately does not cache sensitive text
(`cacheAnswer: params.sensitive !== true`) and calls
`disableBackNavigation()` before/after durable config boundaries. The RPC
prompter does not expose navigation metadata and there is no `wizard.back` RPC.
JunQi therefore cannot prove a replay is pure or reversible. Replaying provider
keys, plugin installation, authorization, service, or config steps extends the
secret lifetime and can repeat side effects that Back cannot undo.

**Target:** remove simulated Wizard Back and all accepted-answer history. Page
Back pauses the existing opaque session and returning resumes it. A terminally
failed session starts a fresh official Wizard without replaying prior answers;
OpenClaw remains responsible for reading its durable config.

### BUG-IW-03 - Cached Docker setup validation fails open

**Severity:** P1

`validateCachedSetupInstallation()` returns `true` for every selected Docker
runtime without calling `check_docker`. A removed Docker CLI, an unsupported
32-bit Windows host, or a missing image while the daemon is available therefore
retains the setup marker and enters the workspace.

Cold recovery correctly refuses to switch runtimes and reports that the selected
Docker daemon is unavailable, but `GatewayErrorScreen` has no return-to-setup or
runtime-selection action. A missing selected runtime can therefore trap the user
behind a full-screen retry loop.

**Target:** cached Docker validation checks the selected runtime's durable
installation contract. Missing/unsupported Docker and a missing image on a
running daemon return to setup. A present CLI with a stopped daemon remains a
cold-start readiness condition and may keep the marker.

### BUG-IW-04 - JunQi's Wizard model invents fields outside the installed schema

**Severity:** P2

JunQi accepts arbitrary future step types and properties, including
`externalUrl`, structured `deviceCode`, arbitrary `format`, and a string index
signature. Tests construct those fields and the UI renders them. The installed
2026.7.1 schema forbids them with `additionalProperties: false`; its device-code
and OAuth flows currently arrive through official note text.

The client also models `wizard.cancel` returning `running` as a durable-write
lock. The installed handler synchronously calls `session.cancel()`, deletes the
session, and returns the cancelled status. This defensive path must not be
documented or tested as current behavior.

**Target:** model and validate exactly the installed step schema. Preserve
option identity and official text, keep URL/QR extraction from message text,
remove unreachable structured-field UI and tests, and fail closed on unknown
response shapes.

### BUG-IW-05 - Setup orchestration ownership is concentrated in one 1403-line hook

**Severity:** P2

`src/hooks/useSetupFlow/index.ts` owns environment detection, operation epochs,
dependency cancellation, Native and Docker installation, Gateway startup,
runtime transactions, navigation, recovery, and dashboard entry. The current
regression suite can assert that each local fragment exists while missing their
end-to-end ownership gap, as BUG-IW-01 demonstrates.

**Target:** extract a setup operation coordinator with one typed operation id
and cancellation lifecycle, then separate installation/runtime orchestration
from the public hook facade. Keep navigation and presentation state out of the
operation service. Do not duplicate cancellation or runtime transaction logic.

## Verified working boundaries

- Frontend command names and argument casing match registered Tauri commands and
  Rust signatures for the audited setup path.
- Native installation validity uses the Rust package/version/entry/Gateway smoke
  contract rather than PATH presence alone.
- Runtime mode changes have a durable rollback marker, explicit compensation,
  and process-start recovery.
- Gateway readiness and final dashboard entry use the selected config's
  authenticated identity, not a TCP-only port probe.
- Native and Docker remain explicit persisted choices; recovery does not silently
  switch runtimes.

## Unverified boundaries

- Windows UAC, NSIS/Scheduled Task, Docker Desktop cold start, and Credential
  Manager behavior were not exercised on physical Windows hardware in this pass.
- macOS signing, notarization, and updater signature verification are release
  infrastructure checks, not proved by source inspection.
- Third-party channel authorization remains plugin-owned; this audit verifies
  protocol presentation and control flow, not every provider account.

## Implementation result

All five findings were addressed in the 2026-07-29 hardening pass:

- `BUG-IW-01`: one operation-scoped coordinator now covers Node, Git,
  OpenClaw npm, and Docker image pulls. Cancellation is fenced by operation id,
  terminates the owned process tree, and waits for process/output cleanup.
- `BUG-IW-02`: the renderer no longer retains or replays Wizard answers. Leaving
  the page pauses the opaque official session; terminal recovery starts fresh.
- `BUG-IW-03`: cached Docker setup now distinguishes durable CLI/image validity
  from a temporarily stopped daemon and fails closed for missing prerequisites.
- `BUG-IW-04`: Wizard normalization now accepts only the installed 2026.7.1
  schema. Authorization URLs and QR payloads continue to derive from official
  message text rather than invented response fields.
- `BUG-IW-05`: operation ownership, progress events, and environment review were
  extracted into focused hooks. The root setup hook was reduced from 1403 to
  1161 lines without moving the same broad responsibility into one new file.

Gateway recovery was also rechecked across ordinary application surfaces.
User-triggered recover/restart actions use `GatewayLifecycleCoordinator`, while
the manager remains the single state-machine/action executor and Rust lifecycle
writes remain serialized by the shared operation gate. The Settings maintenance
action was corrected to use this coordinator instead of calling
`ensureRunning()` directly.

## Validation result

Passed locally on macOS:

- `pnpm lint`
- `pnpm test` (1837 frontend/script tests)
- `pnpm test:rust` (652 passed, 3 environment-mutating tests intentionally ignored)
- `pnpm build`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test` (368 tests)
- `pnpm collab:validate`
- `cargo fmt -- --check`
- `cargo check --lib`
- `git diff --check`

`pnpm tauri build` produced the local arm64 application, DMG, and updater
archive, then stopped at updater signing because this machine has the public key
but no `TAURI_SIGNING_PRIVATE_KEY`. The application is linker ad-hoc signed and
fails `spctl`; it is a local preview artifact, not evidence of Developer ID
signing, notarization, or updater publication. Those release-infrastructure
boundaries remain unverified until the tagged CI jobs complete.
