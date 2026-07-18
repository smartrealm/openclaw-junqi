# OpenClaw Gateway Lifecycle Audit

Reviewed against the bundled OpenClaw `2026.7.1` documentation and CLI source on 2026-07-18.

## Critical Findings

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

1. BUG-GW-01: preserve migration intent for forced relocation.
2. BUG-GW-02: centralize selected-state Gateway readiness and use it at all ownership boundaries.
3. BUG-GW-03: use the same selected-state verification after service restart and service restoration.
4. BUG-GW-04: preserve verified official-service ownership through migration and reject unverified service mutations.

## Official Contracts Used

- `docs/cli/gateway.md`: `/healthz` is liveness; `gateway status --require-rpc` is the scriptable readiness contract; use `gateway restart` for managed services rather than `stop` plus `start`.
- `docs/gateway/multiple-gateways.md`: each instance must have unique state directory, config path, workspace, and port; sharing them causes races.
- `docs/help/environment.md`: `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` are the supported runtime path overrides.
- `docs/cli/gateway-lifecycle.runtime.js`: `OPENCLAW_NO_RESPAWN=1` is supported for parent-managed Gateway processes and keeps routine restarts in-process.
