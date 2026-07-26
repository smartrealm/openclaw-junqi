# OpenClaw Gateway Service Ownership Fix Plan

Date: 2026-07-24

## Execution order

### Phase A - Ownership correctness

| Bug | Files | Fix |
| --- | --- | --- |
| BUG-GSO-01 | `gateway_service.rs`, `gateway.rs` | Remove the five-second fail-open inspection and make offline inspection authoritative. |
| BUG-GSO-02 | `gateway.rs` | Start/rebind an installed selected service; spawn a child only when service absence is proven. |
| BUG-GSO-03 | `gateway.rs` | Remove ambiguous/service-failure managed fallback branches. |
| BUG-GSO-07 | `gateway.rs` | Disarm the start failure guard before successful pending-service return. |
| BUG-GSO-08 | `gateway.rs` | Preserve owned-child identity on authenticated endpoint reuse. |
| BUG-GSO-09 | `gateway.rs` | Reap the old managed child before restart enters common startup. |

### Phase B - Cross-workflow contracts

| Bug | Files | Fix |
| --- | --- | --- |
| BUG-GSO-04 | `gateway.rs`, `gateway_update_handoff.rs`, `storage.rs` | Share the native startup readiness budget across service paths. |
| BUG-GSO-05 | `gateway_update_handoff.rs` | Block updates for every installed foreign/unverifiable service. |
| BUG-GSO-10 | `docker.rs` | Make Native-service release fail closed before Docker startup. |

### Phase C - Public lifecycle surface

| Bug | Files | Fix |
| --- | --- | --- |
| BUG-GSO-06 | `gateway.rs` | Make stop owner-aware and endpoint-verified. |
| BUG-GSO-02/03 | `SetupPage.tsx` | Use the official handoff after enabling autostart instead of a generic fallback-capable restart. |

### Phase D - Regression and cleanup

- Add one Rust behavior test per bug.
- Update source-level TypeScript lifecycle regression assertions.
- Remove obsolete best-effort/fallback symbols and stale comments.
- Run formatting, interface/cleanup searches, Rust tests, targeted frontend
  tests, full TypeScript checking, and the complete test suite.
