# JunQi Desktop Application Autostart Spec

Date: 2026-08-02

## Current Behavior

The Ready screen exposes only the OpenClaw Gateway autostart preference. That
preference registers the Gateway's native system service and must remain
separate from the desktop application's login-item policy.

## Target Behavior

The Ready screen presents an independent JunQi Desktop login-autostart control
alongside the Gateway control. Its state is obtained from the Tauri autostart
plugin and enabling or disabling it changes only JunQi Desktop's own system
login registration. It must not start, stop, register, or hand off OpenClaw.

## Acceptance

- [x] The renderer calls typed JunQi application autostart status, enable, and
  disable IPC wrappers.
- [x] The Rust command surface delegates to the initialized Tauri autostart
  plugin and serializes a camelCase enabled status.
- [x] JunQi Desktop uses the platform-native login mechanism: LaunchAgent on
  macOS, the current-user Run entry on Windows, and an XDG autostart desktop
  entry on Linux, including CentOS and Ubuntu desktop sessions.
- [x] The user can toggle JunQi Desktop's login autostart, see the persisted
  enabled state, and receives an error when an operation fails.
- [x] Gateway autostart remains available only for the selected Native runtime
  and retains its existing official-service handoff behavior.
- [x] Ready-screen navigation is disabled while either autostart operation is
  in progress.
- [x] Gateway and JunQi Desktop autostart rows share the same switch control;
  loading and in-progress states retain that control's layout and expose an
  accessible busy status instead of substituting a button.
