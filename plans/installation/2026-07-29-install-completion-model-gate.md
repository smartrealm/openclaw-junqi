# Install Completion Model Gate Plan

Date: 2026-07-29

1. [x] Add failing behavior tests for Gateway, config, model, and success paths.
2. [x] Implement an injected setup-completion gate service.
3. [x] Route failures through the existing setup state machine and persist only
   after success.
4. [x] Split Wizard response validation by RPC method and remove the impossible
   resumable-cancellation branch.
5. [x] Sanitize frontend Wizard/model diagnostics before UI and setup logs.
6. [x] Update the first-run flow preview and installation audit index.
7. [x] Run focused, full frontend, Rust, boundary, docs, and build validation.
