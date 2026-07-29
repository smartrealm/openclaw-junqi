# OpenClaw Install and Wizard Fourth-Pass Audit

Date: 2026-07-29

## Authority

This follow-up uses the installed `openclaw@2026.7.1` configuration and model
contracts in `docs/concepts/models.md` and `docs/gateway/config-agents.md`.
Gateway reachability is process health only; it does not prove that the selected
runtime config contains a usable primary route or that provider authorization
can execute that route.

## Finding

### BUG-IW-06 - Final dashboard entry validates only Gateway reachability

`useSetupFlow.enterDashboard` probes `probe_selected_gateway` and then persists
the setup-complete marker. Structural onboarding and the live model probe occur
at earlier transitions, but Ready is not a durable snapshot: configuration,
credentials, runtime identity, or provider availability may change before the
user enters the dashboard.

### BUG-IW-07 - Wizard result parsing is looser than the installed protocol

The installed schemas set `additionalProperties: false` for start, next, status,
steps, and options. Start requires a non-empty `sessionId`; next does not permit
`sessionId`. The current shared result parser accepts unknown top-level fields,
accepts a terminal start result without a session id, and permits a session id
in a next result. Status parsing also accepts unknown fields.

The installed `wizard.cancel` handler calls `session.cancel()` synchronously,
reads the resulting status, deletes the session, and responds. For a live
session `WizardSession.cancel()` synchronously sets `status = "cancelled"`.
The renderer's `running` cancellation branch and its documented resumable
cancellation behavior therefore model a response the installed handler cannot
produce.

### BUG-IW-08 - Wizard diagnostics can copy provider secrets into setup logs

Wizard result errors and Gateway RPC errors are appended to renderer setup logs
verbatim. Unlike Rust installer diagnostics, this path has no redaction layer.
A provider or channel plugin can include authorization headers, named token/key
assignments, URL user-info, or recognizable secret tokens in an error. Official
step content remains runtime-owned and must be rendered faithfully, but error
diagnostics must be sanitized before they enter UI or logs.

## Target behavior

The final action uses one completion gate with three ordered checks:

1. the selected Gateway is reachable;
2. the selected-runtime config no longer requires official onboarding;
3. the active runtime can execute its resolved default model probe.

Only a successful gate may persist setup completion. Gateway failure returns to
Gateway recovery; configuration or model failure returns to official OpenClaw
configuration without silently changing runtime or provider.

Wizard responses are parsed per RPC method with exact top-level key sets. Start
requires its session id, next rejects one, status rejects extra fields, and a
successful cancellation accepts only the installed `cancelled` result. Protocol
drift fails visibly while preserving the local session id for diagnosis/retry.
Wizard and live-model error diagnostics pass through one frontend sanitizer;
normal official step messages are not rewritten.

## Verification boundary

Automated tests use injected probes for every branch. Live provider execution
still requires real credentials and is reported separately from code completion.

## Validation

- Setup-completion, Wizard protocol, and diagnostic sanitizer regressions:
  passed as part of the complete frontend suite.
- `pnpm test`: passed with 1863 frontend and 223 script tests.
- `pnpm test:rust`: passed with 652 tests and 3 existing environment-dependent
  tests ignored.
- `pnpm lint`, `cargo fmt -- --check`, `cargo check --lib`, and
  `pnpm verify:openclaw-docs`: passed.
- Live authenticated provider execution, macOS Keychain mutation, signing, and
  notarization were not performed.
