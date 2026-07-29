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
