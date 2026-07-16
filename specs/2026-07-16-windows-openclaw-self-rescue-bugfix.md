# Windows OpenClaw Self-Rescue Bugfix Specification

Date: 2026-07-16

## BUG-WSR-08 - Stop the complete owned Gateway tree

**Current**: `stop_gateway` terminates only the direct child and immediately
reports success.

**Target**: use the shared owned-process terminator, then wait for the selected
Gateway port to become available. The command must still never target a process
that JunQi did not create.

**Acceptance**:

- [x] Windows uses `taskkill /T /F` through `terminate_owned_gateway`.
- [x] A stop success is reported only after the port is released.
- [x] Timeout reports an actionable error and leaves lifecycle state truthful.

## BUG-WSR-09 - Sanitize direct-provider failure output

**Current**: a non-success provider payload becomes an unbounded raw IPC error.

**Target**: sanitize and bound the displayed provider message before it crosses
the Rust-to-frontend boundary. HTTP status remains available for 401/403 UI
classification.

**Acceptance**:

- [x] Credential markers and known secret prefixes are redacted in provider
  failure messages.
- [x] The error remains bounded and preserves the HTTP status code.
- [x] Existing successful direct-provider responses are unchanged.

## BUG-WSR-10 - Ignore obsolete repair continuations

**Current**: a panel-owned repair completion can invoke its restart callback
after unmount.

**Target**: a repair continuation is valid only while the panel remains mounted
and its generation is current. Pending reset timers are also cleared on unmount.

**Acceptance**:

- [x] Unmount prevents state writes and automatic restart from an older repair.
- [x] A current repair still starts Gateway after a successful official repair.
- [x] A failed repair remains visible and retryable while mounted.

## BUG-WSR-11 - Classify concrete listener conflicts only

**Current**: every diagnostic containing `Port ` maps to retry.

**Target**: retry only known transient listener/handshake/migration conditions.

**Acceptance**:

- [x] `Port 18789 still occupied` remains retryable.
- [x] `EADDRINUSE` and `address already in use` are retryable.
- [x] unrelated port text does not override repair/config classification.

## BUG-WSR-12 - Keep direct AI rescue scoped to the active target and panel

**Current**: a direct provider response can be written after the rescue panel
is closed or after the user changes model. A single configured model is shown
as static text instead of a selectable target.

**Target**: every rescue surface exposes a model selector including a
temporary-model option. A pending request is valid only while its panel is
mounted and its selected target remains current.

**Acceptance**:

- [x] A configured single model still exposes the target selector.
- [x] Changing target clears the previous model's conversation and ignores its
  pending response.
- [x] Unmount prevents rescue request state updates.

## BUG-WSR-13 - Abort native launch when the owned port does not release

**Current**: native start/restart can continue after a killed JunQi-owned
child leaves the Gateway port occupied.

**Target**: wait for release remains a hard precondition before starting a new
native Gateway process.

**Acceptance**:

- [x] Restart reports an actionable port-release error instead of launching
  another Gateway.
- [x] Native start does the same after replacing an owned child.
- [x] The failure never kills an unowned listener.

## Validation

- [x] Rust unit tests cover diagnostic classification and sanitized provider
  failure text.
- [x] Frontend regression tests cover stale panel completion guards.
- [x] Frontend regression tests cover stale AI-rescue responses and model
  switching.
- [x] TypeScript type-check, focused frontend tests, `cargo fmt --check`,
  `cargo test --lib`, and boundary checks pass.
