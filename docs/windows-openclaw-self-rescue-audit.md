# Windows OpenClaw Self-Rescue Audit

Date: 2026-07-16

Scope: a fresh JunQi installation on Windows, native Gateway recovery,
official OpenClaw repair, direct-provider AI rescue, and the storage choices
that feed those flows.

## Verified baseline

- A fresh storage bootstrap leaves `node_runtime_dir`, `git_runtime_dir`, and
  `npm_cache_dir` unset. Node.js and Git therefore resolve from the operating
  system unless the user explicitly enables a portable runtime directory.
- Production code no longer constructs, probes, or falls back to private
  Node.js or Git directories beneath OpenClaw data.
- Storage validation rejects a selected portable Node.js or Git directory that
  overlaps the OpenClaw state, workspace, internal runtime, npm cache, or npm
  prefix. A user-selected portable runtime remains supported, but it is not a
  hidden default.
- Gateway start, restart, Docker switching, storage migration, official repair,
  and boot recovery share the `GatewayProcess::operation_gate`. Migration-lock
  retries honor OpenClaw's reported retry-after timestamp.

## Findings

### CRITICAL BUG-WSR-08 - Explicit Gateway stop can leave Windows descendants alive

**Locations**: `src-tauri/src/commands/gateway.rs:1464`,
`src-tauri/src/commands/gateway_supervisor.rs:54`,
`src-tauri/src/commands/process_control.rs:5`

`stop_gateway` calls `Child::kill()` directly. On Windows that only guarantees
termination of the tracked parent, while `terminate_owned_gateway` already uses
`taskkill /T /F` to terminate the owned process tree. A surviving Node/OpenClaw
descendant can retain the Gateway port or a startup-migration lock. The next
start/recovery attempt then races that descendant.

**Impact**:

- A user-visible stop followed by restart can fail despite the UI saying the
  Gateway stopped.
- Subsequent self-repair can report a migration lock caused by JunQi's own
  orphaned child.

**Fix**: make `stop_gateway` use the shared owned-process terminator and wait
for the configured port to be released before reporting success.

### HIGH BUG-WSR-09 - Direct AI rescue returns provider error text without the outbound diagnostic sanitizer

**Locations**: `src-tauri/src/commands/gateway_rescue.rs:198`,
`src/components/GatewayRescueChat.tsx:99`

The rescue prompt sanitizes supplied Gateway diagnostics before the provider
request. However, a non-success provider response is returned as raw text, and
the React view displays that raw error. A provider or proxy can echo request
metadata or credential-shaped text in its error body, defeating the safety
guarantee at the final display boundary.

**Impact**:

- A 4xx/5xx response can expose sensitive-looking diagnostic text in the
  recovery screen.
- The UI's "API Key is not written to diagnostics or logs" contract is not
  defensible for an untrusted provider response.

**Fix**: sanitize and bound both non-success provider messages and transport
errors in Rust before the IPC error is created; keep frontend classification
based on the status code.

### MEDIUM BUG-WSR-10 - A self-rescue panel can restart Gateway after it has unmounted

**Locations**: `src/components/GatewaySelfRescuePanel.tsx:81`,
`src/hooks/useSetupFlow.ts:982`

The setup flow checks its active run after official repair. The shared rescue
panel does not: after `runOpenClawRepair()` resolves, it invokes
`onPrimaryAction()` even if the panel has unmounted or a newer repair action
has superseded it. This can cause an unexpected second restart after a user
navigates away from the recovery surface.

**Impact**:

- A stale repair continuation can modify Gateway lifecycle after its owner is
  gone.
- React state updates can be scheduled after unmount.

**Fix**: give the panel a lifecycle generation and timer cleanup. Only the
currently mounted run may update panel state or request the follow-up restart.

### LOW BUG-WSR-11 - Gateway diagnostics classify every line containing `Port ` as transient

**Locations**: `src-tauri/src/state/gateway_diagnostics.rs:19`,
`src-tauri/src/commands/gateway_supervisor.rs:24`

The real transient condition is a listener conflict (for example
`Port 18789 still occupied`). The classifier currently treats any diagnostic
containing `Port ` as retryable. This can hide a non-transient configuration or
plugin error that happens to mention a port.

**Impact**:

- The recovery UI can recommend retry instead of repair or configuration
  inspection.

**Fix**: match explicit listener-conflict signatures such as `EADDRINUSE`,
`address already in use`, and `port ... occupied`, with regression coverage
for unrelated port text.

### MEDIUM BUG-WSR-12 - Direct AI rescue can apply an obsolete response after a model switch or unmount

**Locations**: `src/components/GatewayRescueChat.tsx:88`,
`src/components/GatewaySelfRescuePanel.tsx:302`

The direct-provider request has no generation guard. If a user changes the
diagnostic target while a request is pending, or closes the rescue surface,
the completed request can write its response into the newer model context or
schedule a React state update after unmount. The selector was also replaced by
static text when exactly one configured model existed, leaving no clear route
to switch to a temporary diagnostic model.

**Fix**: always render a target selector with a temporary-model option, clear
conversation state on a target change, and guard completion with a mounted
request generation.

### HIGH BUG-WSR-13 - Native restart/start continued after an owned child failed to release its port

**Locations**: `src-tauri/src/commands/gateway.rs:1021`,
`src-tauri/src/commands/gateway.rs:1270`

The restart path logged a failed `wait_for_port_free` result and continued to
launch another Gateway. The normal native start path ignored the same result.
On Windows, delayed tree teardown or a surviving external listener then caused
an avoidable second launch failure and obscured the actionable port conflict.

**Fix**: transition to an error state and return the port-release diagnostic
before any new Gateway process is launched. JunQi still never kills an
external listener.

## Deliberate non-findings

- `openclaw update repair` is the official recovery command. Its installed
  documentation states that it runs `doctor --fix` and plugin convergence but
  never restarts Gateway, so JunQi correctly performs the follow-up start only
  after repair completes.
- JunQi does not kill an arbitrary external listener during recovery. Process
  tree termination is restricted to a child that JunQi created and owns.
