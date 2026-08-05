# JunQi Desktop Application Autostart

Date: 2026-08-02

## Basis

The installed Tauri 2.11.5 toolchain is extended with
`tauri-plugin-autostart` 2.5.1. Tauri's official plugin contract initializes a
desktop autostart manager and exposes enable, disable, and enabled-state
operations. Its underlying platform implementation uses a macOS LaunchAgent,
the current-user Windows Run entry, or an XDG Linux autostart desktop entry.

## Behavior

The Ready screen has two separate login-time policies:

- OpenClaw Gateway autostart installs or removes the selected Native-runtime
  OpenClaw service and preserves the official service handoff contract.
- JunQi Desktop login autostart registers or removes only JunQi Desktop's own
  system login entry. It never changes the Gateway's service registration or
  lifecycle.

While either operation is in progress, the Ready-screen navigation controls
remain unavailable so the selected state cannot be left half-applied.

Both policies use the same preference-row component. Before either status has
returned, the row keeps its icon, text and switch footprint as a skeleton.
During a change, the switch remains in place but is disabled, with a visible
spinner and an announced progress message. This avoids swapping a switch for a
button or exposing an incomplete control during the first render.

## Validation

- The application autostart presentation regression covers disabled and enabled
  states independently from Gateway presentation.
- Ready-screen regressions verify both autostart operations lock navigation and
  preserve the Gateway official-service handoff contract.
- The shared preference-row regression verifies loading, ready and in-progress
  states keep an accessible switch action surface.
- `pnpm exec tsc --noEmit`, focused frontend tests, `cargo fmt -- --check`,
  `cargo check --lib`, `cargo test --lib app_autostart`, and `git diff --check`
  passed.
- Rust validation retains one pre-existing unused-variable warning in
  `commands/system.rs`.
- Full `pnpm test` is not clean in the current workspace: the pre-existing
  `gatewayCredentialSecurity.test.ts` WebSocket regression group fails and
  leaves its Node worker alive when run in isolation. This change does not
  modify that test or its Gateway connection sources.

## Remaining Boundary

Automated checks validate the typed IPC, UI state, and plugin initialization.
The resulting login item requires a signed desktop build and a real login
session restart on each target platform to verify through System Settings,
Windows Startup Apps, or the Linux desktop session. The current environment
only has the macOS Rust target installed, so Windows, CentOS, and Ubuntu builds
and login-session behavior remain target-platform verification work. The local
browser connection was unavailable, so no desktop screenshot-level inspection
was performed.
