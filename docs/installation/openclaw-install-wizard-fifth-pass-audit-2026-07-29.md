# OpenClaw Install and Wizard Fifth-Pass Audit

Date: 2026-07-29

## Authority and scope

This pass cross-checks the renderer setup state machine, Tauri IPC wrappers,
Rust setup-operation coordinator, and the installed `openclaw@2026.7.1`
Wizard implementation. The installed package is the protocol authority for
`wizard.start`, `wizard.next`, `wizard.status`, and `wizard.cancel`.

The installed Wizard contract remains aligned with the current client:

- start creates one opaque session and returns the first official step;
- next accepts an optional answer and never requires JunQi to replay answers;
- status reports only the official run status;
- cancel synchronously changes a live session to `cancelled` and removes it;
- the terminal client note is identified by the official `Done` title.

## Findings

### BUG-IW-09 - Install cancellation loses acknowledgement and retry ownership

`useSetupOperationCoordinator.cancelActiveRun` clears the active operation id
before sending `cancel_setup_operation`, then sends the IPC request without
awaiting its result. A transport failure is only written to the debug console.
The visible cancel action subsequently waits for the original transaction, so
the UI can appear to be cancelling while the native npm, installer, or Docker
operation was never asked to stop. Because the operation id was cleared, a
second click cannot retry the same cancellation request.

The Rust command already returns the required acknowledgement contract:
`{ accepted, queued }`. The renderer must retain the operation id until the
owned native call settles, await the acknowledgement for the explicit Cancel
action, surface IPC failure without navigating away, and allow another cancel
attempt against the same operation. Renderer-only invalidation used by stale
navigation may remain best-effort, but it must not be confused with confirmed
user cancellation.

### BUG-IW-10 - Setup diagnostics have several unsanitized UI entry points

The fourth pass added a sanitizer to Wizard/model logs, and the root setup hook
wraps its own log appends. Other setup producers still call the Zustand log
store directly, including Tauri setup progress, Gateway logs, and storage
setup. In addition, raw install/Gateway exceptions can enter `setupError`, the
local status message, Gateway continuation errors, and step details. Those
surfaces are rendered and some can be copied from the installation console.

Diagnostic safety therefore depends on which producer happened to emit the
same error. This violates the minimum-secret boundary even though the store is
session-only. The store must sanitize every setup log/error/status write, while
the setup-flow presentation boundary must sanitize local status and step
details. Official Wizard step objects remain outside this boundary and must be
rendered unchanged.

## Target behavior

Explicit install cancellation has two ordered confirmations:

1. Tauri accepts the cancellation request for the currently owned operation,
   or reports that the operation has already left the native registry;
2. the original setup transaction returns after its native cleanup path.

An IPC failure leaves the user on the current setup page, shows a sanitized and
actionable error, retains operation ownership, and allows retry. Starting or
leaving an obsolete renderer run uses a separately named best-effort
invalidation path so late UI writes remain fenced without claiming confirmed
native cancellation.

All setup diagnostics are sanitized at their storage/presentation boundary,
regardless of producer. Normal official Wizard steps, options, hints, and
messages are not rewritten.

## Verification boundary

Behavior tests use an injected cancellation port and deferred transaction to
prove acknowledgement ordering, retry after IPC failure, and operation-id
retention. Store tests prove every diagnostic write surface redacts credentials.
Real Windows UAC/process-tree termination, Docker Desktop cancellation, live
provider credentials, macOS signing, and notarization remain target-platform
validation rather than automated proof.

## Implemented result

- setup operation ownership now lives in an injected coordinator service;
- explicit cancellation awaits the Tauri request and the owned transaction,
  retains its operation id after transport failure, and remains retryable;
- renderer navigation uses a separately named best-effort invalidation path;
- the setup store sanitizes every log, error, and status write;
- local setup progress and step details pass through one presentation boundary;
- official Wizard steps remain unchanged and follow the installed
  `openclaw@2026.7.1` contract.

## Validation

The following checks passed after the implementation and presentation-boundary
extraction:

- focused cancellation, installer, Wizard, and diagnostic regression tests;
- `pnpm lint` including TypeScript and module-boundary checks;
- `pnpm test` including the complete frontend and script suites;
- `pnpm test:rust` with 652 passing and 3 ignored library tests;
- `cargo fmt -- --check` and `cargo check --lib`;
- `pnpm verify:openclaw-docs` with 55 official links and anchors verified;
- `pnpm build`, including the collaboration package contract and a production
  Vite build of 8,962 modules;
- `git diff --check`.

No Windows UAC/process-tree, Docker Desktop cold-start cancellation, live
provider credential, macOS signing, notarization, or published-release test was
performed in this pass.
