# OpenClaw Setup Second-Pass Audit

Reviewed on 2026-07-20 against the official OpenClaw onboarding, Wizard RPC,
Gateway configuration, Control UI, SecretRef, and service-lifecycle contracts.

## Findings

### BUG-ONB-19 - Stale renderer credentials outrank the selected runtime

**Severity:** P1

The Gateway resolver checks its in-memory token before reading the selected
OpenClaw configuration. Docker startup also bypasses that cache. Switching from
Native to Docker, changing storage, or changing a custom endpoint can therefore
connect to the new URL with a token from the former runtime.

**Target:** resolve credentials for the current endpoint, make native config the
authoritative source, and invalidate endpoint-scoped cache entries on runtime
changes.

### BUG-ONB-20 - Official-service handoff fails open

**Severity:** P1

An inspection failure is converted to `Ok(false)`. The frontend then probes the
still-running JunQi child and may enter Ready although ownership was never
verified and no official service was installed.

**Target:** inspection and unverifiable ownership errors are hard handoff
failures. Only a confirmed absent service or a successful rollback may return a
non-handoff result.

### BUG-ONB-21 - Wizard metadata is treated as proof of usable onboarding

**Severity:** P1

`wizard.lastRunAt` is written by more than successful guided onboarding, and a
configured model string does not prove that its credentials work. Either signal
currently suppresses the official wizard.

**Target:** configuration decides whether onboarding is structurally required;
an official CLI model probe decides whether the configured model is usable.

### BUG-ONB-22 - Official token references are read as literal strings

**Severity:** P1

JunQi accepts only a raw `gateway.auth.token`. Official OpenClaw supports
environment substitution and SecretRef objects backed by environment, file, or
exec providers. Treating those values as literal bearer tokens breaks both
readiness checks and renderer connections.

**Target:** preserve official references and resolve them through the official
OpenClaw boundary. Never persist the resolved secret back into configuration or
renderer storage.

### BUG-ONB-23 - Preserved bind and Control UI policy can contradict JunQi

**Severity:** P1

Existing `lan`, `tailnet`, custom bind, port, and `controlUi.allowedOrigins`
values are preserved while JunQi assumes a loopback URL and its Tauri origin.
This can expose a managed Gateway unexpectedly or pass HTTP liveness while the
WebSocket origin is rejected.

**Target:** managed startup validates bind/port compatibility, merges the
required Tauri origins additively, and keeps dangerous authentication overrides
disabled for fresh configurations.

### BUG-ONB-24 - Device credentials remain in localStorage and config saves clobber URLs

**Severity:** P1

Paired device tokens are written to renderer localStorage. A subsequent partial
`config.save({ gatewayToken })` replaces the complete local config object and can
discard a custom Gateway URL or port.

**Target:** store endpoint-scoped device credentials in the OS credential vault,
migrate and remove legacy renderer values, and merge non-secret renderer config
updates.

### BUG-ONB-25 - Lost terminal Wizard sessions replay onboarding

**Severity:** P2

OpenClaw removes terminal Wizard sessions immediately. When the final response
is lost, JunQi interprets the missing session as an invitation to start a new
wizard and replays completed questions.

**Target:** reconcile current configuration and live model readiness before
creating a replacement session. Continue handoff when completion is already
observable.

### BUG-ONB-26 - OAuth URL and device-code fields are not actionable

**Severity:** P2

The official Wizard step schema can return `externalUrl` and structured
`deviceCode` fields. Setup renders only the message, leaving some authentication
flows without an open-link or copy-code action.

**Target:** type and render both fields, including expiry/status text, copy, and
external-browser actions.

### BUG-ONB-27 - A second, dead Gateway preparation implementation remains

**Severity:** P3

The private Rust `prepare_gateway` implementation is no longer registered or
called but still duplicates installation and startup behavior.

**Target:** delete the implementation and keep one setup lifecycle owner.

## Execution Order

1. BUG-ONB-19 and BUG-ONB-24: establish endpoint-scoped credential ownership.
2. BUG-ONB-20, BUG-ONB-22, and BUG-ONB-23: close backend lifecycle boundaries.
3. BUG-ONB-21, BUG-ONB-25, and BUG-ONB-26: make guided onboarding recoverable.
4. BUG-ONB-27: remove the obsolete implementation after coverage is in place.

## Official Contracts Used

- <https://docs.openclaw.ai/zh-CN/start/wizard>
- <https://docs.openclaw.ai/reference/wizard>
- <https://docs.openclaw.ai/cli/gateway>
- <https://docs.openclaw.ai/gateway/secrets>
- <https://docs.openclaw.ai/gateway/configuration-reference>
- <https://docs.openclaw.ai/control-ui>

