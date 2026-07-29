# Default Model Installed-Contract Audit

Date: 2026-07-29

## Authority

JunQi currently pins `openclaw@2026.7.1`. Its installed strict Zod schema and
runtime model-selection implementation are the contract for this release.
The live OpenClaw documentation already describes a newer
`agents.defaults.modelPolicy.allow` field, but the pinned schema rejects that
field as an unrecognized key under `agents.defaults`.

For the pinned runtime:

- `agents.defaults.model.primary` is the default text route;
- `agents.defaults.model.fallbacks` is the ordered fallback route;
- keys under `agents.defaults.models` provide metadata and also constrain the
  configured model view when the map is non-empty;
- `models.mode` controls catalog discovery and is independent from the default
  route;
- a session model remains an explicit `sessions.patch` override and clearing it
  uses `model: null`.

The live [OpenClaw model documentation](https://docs.openclaw.ai/concepts/models)
is retained as an upgrade signal, not substituted for the installed contract.

## Findings

### BUG-DM-15 - JunQi can write a field rejected by the pinned Runtime

The provider page exposes session-model access through
`agents.defaults.modelPolicy.allow`. The installed `OpenClawSchema.safeParse`
returns an `unrecognized_keys` issue for that field. Saving it can therefore
turn an otherwise valid OpenClaw configuration into a rejected configuration.

This control and its write path must be removed for the pinned runtime. A future
OpenClaw upgrade may restore it only after the dependency, schema projection,
tests, and UI are upgraded together.

### BUG-DM-16 - Offline model discovery applies the wrong visibility contract

The Gateway `models.list { view: "configured" }` response is authoritative
while connected. JunQi's config/file fallback instead filters models through
the unsupported `modelPolicy.allow` field. When the Gateway is unavailable,
the model picker can therefore expose a different set from the pinned Runtime.

The fallback must implement the installed `agents.defaults.models` exact-key
and `provider/*` visibility rules, including the pinned Runtime's explicit
primary/fallback preservation behavior.

### BUG-DM-17 - The default selector hides a valid explicit route

The provider page renders the text primary only when the same key also exists
in `agents.defaults.models`. A valid explicit primary outside that local
metadata map is displayed as `Not set`; an empty map also disables the control.
An unrelated provider edit can then reconcile or clear routing from a UI state
that never showed the persisted value.

The selector must always include and display the explicit primary. Omitted
reconciliation preserves it; only an explicit clear or removal of that exact
model may change it.

## Verification boundary

Behavior tests must cover the installed schema rejection, config fallback
visibility, an explicit primary outside the metadata map, wildcard visibility,
and explicit clear. Live provider credentials and a future OpenClaw version are
not inferred from these tests.

## Verification result

Focused default-model behavior tests passed 52/52. Repository lint and module
boundaries, the complete frontend/script suites, Rust library tests, official
OpenClaw link verification, collaboration package tests/validation, and the
Vite production build also passed. The build emitted neither circular chunk
warnings nor a JavaScript chunk-budget failure. Live provider credentials and a
future OpenClaw upgrade were not exercised.
