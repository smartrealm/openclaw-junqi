# Install Cancellation and Diagnostic Boundary Spec

Date: 2026-07-29

## Acceptance

- [x] The explicit Cancel action awaits the Tauri cancellation acknowledgement
      before treating the operation as stopping.
- [x] The active operation id remains available until the native call settles.
- [x] A cancellation IPC failure is visible, does not navigate away, and can be
      retried against the same operation id.
- [x] The setup transaction is not released until the owned native operation
      has returned from its cleanup path.
- [x] Renderer run invalidation and confirmed user cancellation are separate,
      clearly named coordinator operations.
- [x] The coordinator is a small injected service with behavior tests rather
      than more lifecycle branching in the setup hook.
- [x] Setup logs, setup errors, setup status, continuation errors, and step
      details redact credentials regardless of producer.
- [x] Official Wizard step content remains protocol-owned and unmodified.
- [x] IPC argument names and camelCase cancellation result fields remain exact
      matches for the registered Rust command.
