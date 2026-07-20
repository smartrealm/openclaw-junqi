# Windows Native Installation Audit

Date: 2026-07-21

## Critical findings

### BUG-WIN-INSTALL-12 - Offline service status blocked foreground Gateway start

`start_gateway_locked` queried `openclaw gateway status --json` twice. The first
failure was ignored and the second was propagated after lifecycle state changed
to `Starting`. A 30-second service-command timeout therefore produced a generic
spawn failure before `gateway run` was ever spawned.

### BUG-WIN-INSTALL-13 - Windows dependency completion was observed too early

MSI and winget launcher processes can exit before registry/PATH changes become
visible. Node channel fallback and Git verification ran immediately, which could
observe an old Node version or missing `git.exe` and start another installer.

### BUG-WIN-INSTALL-14 - Git was installed before npm proved it was required

The npm installation path always installed a full system Git first. Machines
with an existing OpenClaw package, or npm packages without Git dependencies,
paid the UAC and installer cost without using Git.

## Medium findings

### BUG-WIN-INSTALL-15 - Installer progress was synthetic

The displayed percentage advanced against a hard-coded 20-minute estimate.
That value did not represent MSI, Inno Setup, or winget progress.

### BUG-WIN-INSTALL-16 - Installer and Gateway diagnostics lost the failing stage

The UI did not distinguish UAC wait, installer execution, runtime publication,
service handoff, child spawn, and readiness. Direct installers also lacked a
persistent diagnostic log path on failure.

## Resolution

- Gateway startup uses one bounded, no-probe ownership snapshot and reuses it
  for any verified service stop.
- Valid service JSON is parsed even when the CLI exits non-zero because the
  endpoint is offline.
- Node and Git wait for their post-installer runtime contract before fallback.
- Windows Git installation is deferred until npm reports a missing Git process.
- Installer progress remains at the indeterminate phase boundary and reports
  elapsed time instead of a fabricated percentage.
- UAC wait and runtime-settle phases are localized.
- Failed MSI/Inno Setup logs are preserved under JunQi's application config
  directory.
- npm failures retain a bounded, credential-redacted diagnostic tail so a
  missing `git.exe` can trigger the one permitted Git recovery retry.
- Gateway lifecycle failures retain the actual startup stage.

### BUG-WIN-INSTALL-17 - winget upgrade success was treated as installation success

`winget upgrade` can exit successfully when the package is already current,
absent from the upgrade set, or owned by another source. The previous flow
returned at that point without proving that the selected Node.js contract had
changed, then started another channel while the machine still exposed the old
runtime (the observed v20 -> LTS -> Current loop).

The package-manager path now performs one exact, forced `winget install` from
the `winget` source and leaves version validation to the Node runtime contract.
Each Windows installer/process-manager wait is bounded to five minutes; a
timeout is cleaned up before a fallback can start.
