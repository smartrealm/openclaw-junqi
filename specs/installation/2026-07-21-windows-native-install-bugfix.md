# Windows Native Installation Bugfix Specification

## BUG-WIN-INSTALL-12 - Gateway service handoff

Current: foreground startup performs redundant service status commands and can
fail before spawning the managed child.

Target: one bounded metadata snapshot is reused for service ownership and stop.
Unavailable metadata is a warning, not a foreground-start blocker.

Acceptance:

- [x] Status JSON is accepted when OpenClaw exits non-zero for an offline endpoint.
- [x] Startup service inspection uses `--no-probe` and a five-second bound.
- [x] A verified stop does not execute a second status query.

## BUG-WIN-INSTALL-13 - Dependency completion contract

Current: runtime verification runs immediately after MSI/winget root exit.

Target: Node/npm and Git are polled against their executable contracts during a
bounded settle phase before another provider or channel starts.

Acceptance:

- [x] Cancellation stops fallback instead of being treated as retryable.
- [x] Node LTS fallback reaches Current only after the settle contract fails.
- [x] Git verification uses the same settle contract after direct and winget installs.

## BUG-WIN-INSTALL-14 - Conditional Git installation

Current: every Windows npm setup installs Git before Node and OpenClaw.

Target: missing Git is deferred; OpenClaw installation requests Git only after a
specific missing-process error, then retries once.

Acceptance:

- [x] Existing Git is still detected and displayed.
- [x] Missing Git is skipped when npm does not require it.
- [x] A missing-Git npm error installs Git and retries the same OpenClaw operation.
- [x] npm's bounded failure tail is redacted before it crosses the IPC boundary.

## BUG-WIN-INSTALL-15/16 - Progress and diagnostics

Current: time-derived percentages and generic failure messages obscure the stage.

Target: indeterminate phase progress, localized UAC/runtime-settle messages,
persistent installer logs, and typed Gateway startup stages.

Acceptance:

- [x] No elapsed-time formula fabricates installer completion.
- [x] Direct MSI and Inno Setup failures preserve their diagnostic log.
- [x] Gateway lifecycle reports preparation, state probe, service rebind, spawn,
      or readiness failure separately.

## BUG-WIN-INSTALL-17 - Package-manager installation contract

Current: a successful `winget upgrade` could short-circuit without installing
the requested package, leaving an incompatible Node.js runtime in place and
causing a second channel plus another UAC wait.

Target: perform one exact forced install from the deterministic `winget` source,
then verify the complete Node.js/npm contract before selecting a fallback.

Acceptance:

- [x] The Windows package-manager path does not use `winget upgrade` as proof of installation.
- [x] `winget install` is exact, silent, non-interactive, source-pinned, and forced.
- [x] Installer/package-manager waits terminate and clean up after five minutes.
- [x] A second Node channel is attempted only after the first channel's runtime
      contract remains incompatible.
