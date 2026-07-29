# OpenClaw Install and Wizard Sixth-Pass Audit

Date: 2026-07-29

## Scope

This pass follows setup from the cached completion marker through runtime
selection, native or Docker installation, Gateway startup, official Wizard
handoff, post-Wizard model readiness, and dashboard entry. The pinned
`openclaw@2026.7.1` Wizard remains the protocol authority.

## Findings

### BUG-IW-11 - Setup transaction admission can reject outside its error boundary

Native and Docker setup call `beginSetupTransaction` before entering their
`try/catch/finally`. The coordinator throws while an earlier transaction is
still stopping. Several UI callers intentionally fire these async functions
without awaiting them, so this admission race can surface as an unhandled
Promise rejection instead of a controlled busy result.

Transaction admission must be non-throwing. A competing run receives `false`,
does not mutate setup presentation, and lets the already-owned transaction
finish. The runtime-selection transaction can then compensate through its
existing failure result.

### BUG-IW-12 - Invalid cached setup is not invalidated durably

`setSetupComplete(null)` returns the current process to setup but leaves the
`junqi-setup-done` marker in local storage. A subsequent restart can consume the
same stale marker again. The store owns this marker and must remove it for every
non-complete state; callers must not duplicate the storage key.

### BUG-IW-13 - Runtime refresh reuses stale onboarding state

After an OpenClaw update, `refreshRuntime` re-detects the selected runtime and
Gateway process but routes from `needsOnboardingRef`, which was computed before
the external update/repair. A running Gateway can therefore navigate to Ready
or Wizard from stale configuration state.

Refresh must re-read the selected runtime configuration and update the shared
onboarding requirement before it returns. The screen must navigate from the
returned refreshed requirement rather than a render-time closure.

## Structural boundary

The root setup hook remains a coordinator, not an installer implementation.
Native/Docker installer execution and refreshed runtime classification should
move behind focused hooks or services with typed ports. No new setup state key,
Gateway retry implementation, or default-model fallback is added locally.

## Verification boundary

Behavior tests cover non-throwing transaction admission and marker ownership.
Focused setup tests cover refreshed onboarding routing. Windows UAC/process
trees, Docker Desktop cold start, live provider credentials, macOS signing,
notarization, and published artifacts remain unverified on target platforms.

## Verification result

Focused setup/Gateway behavior tests passed 105/105. Repository lint and module
boundaries, 1,874 frontend tests, 223 script tests, 652 Rust library tests, 368
collaboration package tests, package validation, 55 official OpenClaw links,
and the production Vite build passed. Three Rust tests remained intentionally
ignored because they require the current user's macOS Keychain or an installed
authenticated Codex CLI. Windows UAC, Docker Desktop cold start, live Gateway
pairing/model credentials, signed packaging, and notarization were not tested.
