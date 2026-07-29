# Gateway lifecycle coordinator implementation plan

## Scope

Unify ordinary frontend Gateway restart/recovery orchestration without changing Rust runtime ownership, collaboration bootstrap, or OpenClaw update transactions.

## Execution order

1. Add behavioral tests for coordinator single-flight, recover-before-restart, migration wait, failure, and progress.
2. Add `GatewayLifecycleCoordinator` over `GatewayConnectionManager` with injectable migration-wait and observer hooks.
3. Move App recovery entry points to the coordinator and retain only a temporary event compatibility adapter if required.
4. Migrate direct callers in layout, settings, setup, channels, agent binding, config apply, and Wizard reclaim.
5. Remove the no-consumer `aegis:gateway-restart-requested` event and correct the Rust alias comment.
6. Add a source-boundary regression test that permits low-level restart only inside the coordinator/adapter.
7. Update lifecycle audit/validation documentation and run targeted then full validation.

## Files expected

- `src/services/gateway/GatewayLifecycleCoordinator.ts`
- `src/services/gateway/GatewayLifecycleCoordinator.test.ts`
- `src/App.tsx`
- ordinary lifecycle callers under `src/components`, `src/pages`, and `src/hooks`
- `src/services/gateway/gatewayRecoveryRegression.test.ts`
- `src-tauri/src/commands/gateway.rs`
- `docs/gateway/openclaw-gateway-lifecycle-audit.md`
- `docs/README.md`

## Safety constraints

- Do not silently switch the selected runtime.
- Do not treat process liveness as selected-runtime readiness.
- Preserve “configuration saved, runtime apply failed” semantics.
- Do not route collaboration bootstrap or OpenClaw update through ordinary restart.
- Preserve unrelated dirty-worktree changes.
