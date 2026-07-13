# Setup Installer Audit

## Findings

### BUG-01 - Critical - Silent npm work is treated as a stalled install

**Location**: `src-tauri/src/commands/setup.rs`

The inactivity watchdog only observes newline-delimited npm output. OpenClaw is a large package (currently about 86 MB and 8,944 files) with preinstall and postinstall scripts, so npm can spend a long time extracting files or running a quiet lifecycle script. Older invocations did not request transport logs, while the current display filter removes every `npm http` line.

**Impact**: a healthy mirror install can be killed after six quiet minutes and restarted from an empty cache against the fallback registry.

**Fix**: use npm's HTTP log level, surface sanitized fetch lines, run lifecycle scripts in the foreground, and emit periodic phase heartbeats without treating the heartbeat itself as child-process activity.

### BUG-02 - Medium - Registry selection is opaque and tests only metadata latency

**Location**: `src-tauri/src/commands/npm_registry.rs`, `src-tauri/src/commands/setup.rs`

Both registries are queried for current package metadata and the selected registry is passed through process-scoped npm environment variables. The probe does not measure the package tarball or dependency-tree throughput, and the UI announces a hard-coded mirror preference instead of the actual selected order.

**Impact**: users cannot distinguish a missing registry override from a slow mirror payload or lifecycle phase.

**Fix**: retain process-scoped registry configuration, report the selected source order and package version, and show live HTTP fetch activity.

### BUG-03 - Medium - Dependency versions disappear after installation

**Location**: `src/hooks/useSetupFlow.ts`, `src/api/tauri-commands.ts`, `src-tauri/src/commands/system.rs`

Git and Node versions are shown only when they were already installed. Node and OpenClaw are marked complete without re-reading their installed versions, and npm has no timeline step.

**Impact**: the execution-step UI cannot confirm which dependency versions are actually being used.

**Fix**: add npm detection, give npm its own timeline row, and refresh Node/npm/OpenClaw status after installation.

### BUG-04 - Medium - Windows setup subprocesses can open console windows

**Location**: `src-tauri/src/commands/setup.rs`, `src-tauri/src/commands/system.rs`

The npm installer itself uses `CREATE_NO_WINDOW`, but several Node, npm-prefix, Git, and verification commands do not. The Git path is documented as managed MinGit but currently launches the full interactive Git for Windows installer.

**Impact**: setup can flash several CMD windows and require an unrelated installer wizard.

**Fix**: apply the background-process flag to every non-interactive setup command and install the official MinGit ZIP into JunQi's managed runtime directory.

## Validation

- Rust library tests: 191 passed, 2 ignored.
- Frontend tests: 573 passed.
- Architecture boundary tests: 15 passed.
- TypeScript type-check and locale JSON parsing passed.
- Regression coverage locks registry version selection, sanitized npm progress, bounded log output, and non-interactive MinGit archive sources.
