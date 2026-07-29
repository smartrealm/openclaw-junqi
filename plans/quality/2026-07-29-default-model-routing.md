# Default Model Routing Plan

Date: 2026-07-29

1. [x] Remove config-save and catalog-load session mutations.
2. [x] Remove the renderer model shadow cache and its cleanup callers.
3. [x] Extend the typed session settings client to clear an override with `null`.
4. [x] Add a focused restore-default action to the composer runtime control.
5. [x] Remove provider-editor render-time default selection.
6. [x] Validate the Gateway-resolved effective model and add regression tests
   for config/session separation and exact IPC payloads.
7. [x] Run focused and full validation before resuming release work.
8. [x] Remove implicit default selection from provider addition and preserve
   existing text/image routing unless the operator explicitly changes it.
9. [x] Centralize primary/fallback disjointness in the model-reference domain.
10. [x] Remove model-specific display branches and preserve authoritative
    provider identities at the Gateway/model-catalog projection boundary.
11. [x] Add behavior regressions and rerun focused, lint, full test, and build
    validation.
12. [x] Separate omitted overrides from explicit clears in the shared default
    model reconciliation domain.
13. [x] Reconcile removed primaries through ordered configured fallbacks only.
14. [x] Reuse one final setup-completion gate for Gateway, selected config, and
    live model readiness.
15. [x] Remove catalog-order assumptions from rescue labels and remove the
    `modelPolicy` editor rejected by the pinned Runtime.
16. [x] Add behavior regressions and rerun focused, lint, full test, Rust, and
    production build validation.
