# OpenClaw Gateway Lifecycle Audit

Reviewed against the bundled OpenClaw `2026.7.1` documentation and CLI source on 2026-07-18.

## Critical Findings

### BUG-WIN-05 - Service identity is incomplete and restart bypasses ownership

**Locations:** `src-tauri/src/commands/gateway_service.rs`, `src-tauri/src/commands/gateway.rs`

The selected service is currently identified only by `OPENCLAW_STATE_DIR`, while
the configured path and profile/task identity are ignored. The desktop restart
path bypasses this check entirely and invokes the platform-global
`openclaw gateway restart` command. On Windows, that command operates on the
registered Scheduled Task name and may stop or restart a task belonging to a
different config in the same state root.

**Target:** represent service identity as one value object containing normalized
state directory, normalized config path, and the selected profile/task identity.
Every service mutation must pass through one ownership policy and fail closed.

### BUG-WIN-06 - Migration conflates installed and running service state

**Location:** `src-tauri/src/commands/storage.rs`

Storage migration records whether the endpoint was reachable and whether an
owned service was present, but it only rewrites the destination service when the
endpoint was reachable. An installed but stopped Scheduled Task remains bound to
the old state directory, config path, Node/OpenClaw entry, or npm prefix.

**Target:** preserve `service installed` independently from `was running`.
Rewrite an owned service whenever state, config, Node runtime, or npm prefix
changes; restore its running state separately.

### BUG-WIN-07 - Forced storage recovery derives paths from the wrong source

**Locations:** `src/components/setup/StorageSetupGate.tsx`, `src-tauri/src/commands/storage.rs`

Forced recovery initializes the current configured state but remaps child paths
relative to the legacy default. A custom Windows state directory therefore
retains stale workspace/runtime paths when moved. Selecting the same incompatible
directory also bypasses the authoritative Node filesystem capability probe.

**Target:** derive every migration path from the configured source state and run
the same capability contract for same-location recovery before accepting it.

### BUG-WIN-08 - Host and container workspace paths share one field

**Locations:** `src-tauri/src/commands/docker.rs`, `src-tauri/src/commands/storage.rs`

Docker configuration stores a container path such as
`/home/node/.openclaw/workspace`, but host-side code reads it as a Windows path
for directory creation and bind mounts. Migration performs the inverse error by
writing a host path into container configuration.

**Target:** introduce an explicit runtime path mapping with separate host and
container workspace values. Bootstrap owns host paths; Docker config owns only
container paths.

### BUG-WIN-09 - Windows dependency installation is not a bounded transaction

**Locations:** `src-tauri/src/commands/setup.rs`, `src-tauri/src/commands/npm_registry.rs`, `src-tauri/src/commands/system.rs`

Installer and winget timeouts can leave child processes running while fallback
installation begins. Registry selection can omit the official npm fallback, and
OpenClaw validation can promote a package without its JavaScript entry point.
Several version/prefix probes have no timeout.

**Target:** supervise every child process with termination on timeout, use a
dependency-level deadline across fallback attempts, retain validated registry
fallbacks, and validate the complete executable contract before promotion/reuse.

### BUG-WIN-10 - Wizard and runtime transitions have multiple owners

**Locations:** `src/services/openclawWizard.ts`, `src/hooks/useSetupFlow.ts`, `src-tauri/src/commands/docker.rs`

The RPC QuickStart wizard installs a Scheduled Task while JunQi's bootstrap
Gateway still owns the port. Runtime switching also relies on stale frontend
closures and does not consistently release an owned service before Docker.

**Target:** one deployment coordinator owns foreground-to-service and
Native-to-Docker transitions. The transition is complete only after the target
runtime accepts the selected token and every former owned runtime is stopped.

### BUG-WIN-11 - Uninstall and release gates leave Windows state behind

**Locations:** `src-tauri/tauri.conf.json`, `.github/workflows/release.yml`,
`src-tauri/src/commands/terminal_integration/windows.rs`

The default uninstaller can terminate the desktop process without cleaning its
managed Node child or user PATH entry. Release jobs also publish unsigned Windows
installers when Authenticode configuration is absent.

**Target:** uninstall cleanup is idempotent and ownership-aware, and tag releases
fail when required Authenticode material or verification is unavailable.

### BUG-GW-01 - Forced state relocation can create an empty state directory

**Location:** `src/components/setup/StorageSetupGate.tsx`

When Gateway recovery sends an already configured installation back to storage selection, `forceConfigure` correctly selects the current state directory and marks migration as requested. The IPC payload nevertheless requires `status.legacyExists`, which describes the old default directory rather than the configured source. Users with a custom source directory can therefore create a fresh target and lose access to the source configuration, credentials, sessions, and workspace.

**Target:** derive the migration intent from the selected source, not the existence of the legacy default directory.

### BUG-GW-02 - Liveness can be mistaken for ownership

**Locations:** `src-tauri/src/commands/ensure.rs`, `src-tauri/src/commands/gateway.rs`, `src-tauri/src/commands/setup.rs`, `src-tauri/src/commands/storage.rs`

OpenClaw documents `/healthz` as liveness only and `gateway status --require-rpc` as the stronger automation check. Several JunQi lifecycle decisions use `/healthz` alone, then return the token from JunQi's selected config. A Gateway from another state directory on the same port can therefore be attached as if it belonged to the selected state.

**Target:** every decision to attach to, restore, or declare an external Gateway ready must prove both OpenClaw liveness and acceptance of the selected config token. A child process already owned by JunQi may use its own identity-aware readiness path.

### BUG-GW-03 - Restart success is accepted before selected-state verification

**Location:** `src-tauri/src/commands/gateway.rs`

`gateway restart` targets the service manager. A stale scheduled task can restart with its own persisted state/config even though the CLI command is invoked with JunQi's current environment. The current post-restart liveness-only check reports success in that case.

**Target:** verify the restarted endpoint against the selected config token before reporting `SystemService` success; otherwise return an explicit state-directory mismatch and do not fall through to a competing managed child.

### BUG-GW-04 - Storage migration loses official-service ownership after application restart

**Locations:** `src-tauri/src/commands/gateway.rs`, `src-tauri/src/commands/storage.rs`

`GatewayProcess` is in-memory. After a JunQi restart, an already installed official OpenClaw service is observed as an external endpoint, even when the service definition explicitly declares JunQi's selected `OPENCLAW_STATE_DIR`. Storage migration then starts a managed child at the new location while the old service definition remains installed. A later system-service restart can therefore return to the old state directory.

The former storage stop path also issued `gateway stop` without proving that the service belonged to the selected state. That could stop another OpenClaw installation on the machine.

**Target:** use the official `gateway status --json` service definition as the ownership contract. Only a service whose declared `OPENCLAW_STATE_DIR` resolves to the selected state may be stopped, migrated, and reinstalled. Missing or unverifiable service metadata must be treated as non-owned and left untouched.

## Execution Order

1. BUG-WIN-05 and BUG-WIN-06: establish service identity and migration state contracts.
2. BUG-WIN-07 and BUG-WIN-08: separate configured source, host paths, and runtime paths.
3. BUG-WIN-09: bound dependency installation and verify the complete package contract.
4. BUG-WIN-10: make runtime and wizard handoff single-owner transitions.
5. BUG-WIN-11: close uninstall and release gates.
6. Revalidate BUG-GW-01 through BUG-GW-04 against the new shared contracts.

## Official Contracts Used

- `docs/cli/gateway.md`: `/healthz` is liveness; `gateway status --require-rpc` is the scriptable readiness contract; use `gateway restart` for managed services rather than `stop` plus `start`.
- `docs/gateway/multiple-gateways.md`: each instance must have unique state directory, config path, workspace, and port; sharing them causes races.
- `docs/help/environment.md`: `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` are the supported runtime path overrides.
- `docs/cli/gateway-lifecycle.runtime.js`: `OPENCLAW_NO_RESPAWN=1` is supported for parent-managed Gateway processes and keeps routine restarts in-process.
