# Windows Installation Flow Audit

Date: 2026-07-15

Status: implementation resolved in the current worktree on 2026-07-16.
Mainland China network availability is a release requirement.

Scope: Windows NSIS/MSI packaging, first-run Native installation, managed
Node/MinGit bootstrap, OpenClaw npm installation, and terminal launcher setup.
The review uses the current worktree, including uncommitted setup/runtime changes.

## Critical Findings

### BUG-WIN-INSTALL-01 - Registry PATH refresh can break the remaining setup

**Location**: `src-tauri/src/commands/setup.rs:28`,
`src/hooks/useSetupFlow.ts:672`

`refresh_path_from_registry` reads raw registry bytes and writes them directly to
the process `PATH`. Windows `REG_EXPAND_SZ` entries such as
`%USERPROFILE%\AppData\Local\Microsoft\WindowsApps` and
`%SystemRoot%\System32` are not expanded. The function also discards any
process-only PATH entries.

The original clean-machine flow installed Git first, refreshed PATH, then
started Node installation through `winget`. Because winget is commonly exposed
by WindowsApps, the refresh could make the second invocation unresolvable.

**Impact**:

- A fresh Windows setup can succeed at Git and fail immediately at Node.
- Later command discovery can disagree with the user's actual login environment.
- Terminal integration calls the same refresh and can break an otherwise valid
  running process after setup.

**Fix proposal**: read expanded registry strings (or call the Windows expansion
API), merge machine and user PATH with required process-only entries, normalize
and deduplicate entries case-insensitively, and add Windows-native tests using
`REG_EXPAND_SZ` fixtures.

### BUG-WIN-INSTALL-02 - OpenClaw promotion is not rollback-safe

**Location**: `src-tauri/src/commands/setup.rs:1038`

The promotion sequence moves the current package to a PID-named backup, moves
the staged package into place, and then copies launcher shims with `?`. A shim
copy failure returns without restoring the old package. A process crash after
the first rename also leaves the backup behind; the next attempt deletes that
backup unconditionally before checking whether it is the only recoverable
installation.

**Impact**:

- An antivirus lock, disk-full condition, or crash can turn a working install
  into a partial package with missing or stale launchers.
- Retry can delete the only backup and make recovery impossible.
- The UI reports installation failure, but the on-disk state has already been
  mutated.

**Fix proposal**: use a unique transaction directory and a recovery marker;
stage and validate package plus all shims before activation; restore package and
shims on every post-backup failure; recover stale transactions before deleting
anything; add fault-injection tests for each filesystem operation.

## High Findings

### BUG-WIN-INSTALL-03 - Published Windows installers are not Authenticode-signed

**Location**: `.github/workflows/release.yml:157`,
`src-tauri/tauri.conf.json:50`

The workflow supplies Tauri updater signing keys but no Windows code-signing
certificate, thumbprint, or signing command. The generated x64 NSIS artifact in
`release-artifacts` has a zero PE Security Directory, confirming that it has no
embedded Authenticode signature.

**Impact**:

- SmartScreen and enterprise application-control policies can block or strongly
  warn on installation.
- Users cannot verify the Windows publisher identity from the installer.
- Updater signatures protect update payload integrity but do not replace OS
  executable signing.

**Fix proposal**: sign the application binary and both NSIS/MSI bundles with a
trusted Windows code-signing certificate and timestamp service, then fail the
release job unless signature verification succeeds for every Windows artifact.

### BUG-WIN-INSTALL-04 - winget was a hard dependency with no supported fallback

**Location**: `src-tauri/src/commands/setup.rs:544`,
`src-tauri/src/commands/setup.rs:602`, `src-tauri/src/commands/setup.rs:780`

The earlier implementation invoked `winget` for both Node and Git. This also
made installation depend on Microsoft package sources that are not reliable for
the product's mainland China users.

**Impact**:

- Windows editions/images without a usable winget cannot complete Native setup.
- The generic spawn error does not tell the user how to repair App Installer or
  install the exact required dependency manually.

**Resolution**: use a user-scoped portable Node.js and MinGit runtime. Resolve
Node releases, archives, and SHASUMS from npmmirror first; pin MinGit assets to
publisher SHA-256 values and download them from npmmirror first. Official
overseas sources are fallback-only.

## Medium Findings

### BUG-WIN-INSTALL-05 - A generic package installer is exposed to every WebView

**Location**: `src-tauri/src/commands/setup.rs:1520`,
`src-tauri/src/lib.rs:96`, `src-tauri/capabilities/default.json:5`

`install_winget_package` accepts any syntactically valid package ID and is
registered in the global invoke handler, although no frontend call site uses it.
All application windows share one broad capability and the application CSP is
disabled.

**Impact**:

- A renderer compromise has a ready-made package-install primitive beyond the
  fixed Node/Git packages needed by setup.
- The dead public command expands security and maintenance surface without a
  product workflow.

**Fix proposal**: remove the unused command. If a generic installer is a real
product requirement, enforce a backend allowlist and expose it only to the main
setup window through a dedicated capability.

### BUG-WIN-INSTALL-06 - Reinstall can install a second copy instead of replacing the detected copy

**Location**: `src-tauri/src/commands/setup.rs:1193`,
`src-tauri/src/commands/setup.rs:1277`, `src-tauri/src/commands/system.rs:492`

The reinstall path detects OpenClaw across saved selections, npm prefixes,
Scoop, pnpm, Program Files, and PATH. It then independently calls
`pick_install_target`, which may select a different npm prefix. Therefore the
detected package is not necessarily the package being forced and promoted.

**Impact**:

- “Reinstall” can leave the broken/old installation untouched and create a
  second installation elsewhere.
- Terminal and external shells may continue resolving different copies even
  though JunQi persists the newly created one.

**Fix proposal**: classify the detected installation. Reinstall in place only
for JunQi/npm-managed layouts; otherwise present an explicit “adopt managed
copy” migration and show the old and new locations before changing selection.

## Test and Release Gaps

- The existing 21 setup regression tests pass, but they are primarily source
  contract assertions and do not exercise Windows registry or filesystem fault
  behavior.
- Windows CI compiles, runs Rust unit tests, and builds NSIS, but never installs,
  launches, upgrades, or uninstalls the generated package.
- Release CI validates the macOS image/signature but has no equivalent Windows
  installer structure or signature verification step.
- The local audit host is macOS and has no `rustup` command, so Windows-native
  compilation and runtime tests were not rerun locally.

## Recommended Fix Order

1. BUG-WIN-INSTALL-01: preserve and correctly expand Windows PATH.
2. BUG-WIN-INSTALL-02: make OpenClaw activation recoverable and transactional.
3. BUG-WIN-INSTALL-03: add Windows code signing and release verification.
4. BUG-WIN-INSTALL-04: define behavior when winget is unavailable.
5. BUG-WIN-INSTALL-05: remove or constrain the generic installer command.
6. BUG-WIN-INSTALL-06: make reinstall ownership and target explicit.

## Resolution Record

- BUG-WIN-INSTALL-01: registry `REG_EXPAND_SZ` values are expanded with the
  Windows API; machine, user, and live process PATH entries are merged and
  deduplicated without discarding process-only paths.
- BUG-WIN-INSTALL-02: package promotion now uses a persistent marker, package
  and launcher backups, automatic interrupted-transaction recovery, and
  rollback on every activation failure.
- BUG-WIN-INSTALL-03: tagged Windows releases submit the application and
  installers to SignPath Foundation, then verify every EXE/MSI with
  `Get-AuthenticodeSignature`. No PFX is stored in the repository or CI.
- BUG-WIN-INSTALL-04: winget is no longer part of the install path. Node and
  MinGit use transactional, SHA-256-verified portable installations with
  npmmirror as the primary source.
- BUG-WIN-INSTALL-05: the unused generic `install_winget_package` Tauri command
  and invoke registration were removed.
- BUG-WIN-INSTALL-06: reinstall derives and reuses the detected npm prefix; an
  externally managed installation is rejected with explicit ownership guidance
  instead of receiving a hidden second copy.

## Final Validation

- Rust library tests: 309 passed, 0 failed, 2 ignored.
- Frontend tests: 777 passed, 0 failed.
- Script tests: 23 passed, 0 failed.
- Production build: passed.
- TypeScript and module-boundary lint: passed.
- Rust formatting and `git diff --check`: passed.
- Windows target compilation remains delegated to the existing Windows CI job
  because the local macOS toolchain does not include the MSVC standard library.
- Tagged release signing fails closed until the SignPath Foundation project and
  six repository secrets in `docs/signpath-foundation-setup.md` are configured.
- WebView2 uses Tauri's offline installer mode. The desktop updater has no
  default endpoint until a mainland-hosted signed update service is provisioned.
