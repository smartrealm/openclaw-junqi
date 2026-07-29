# Default Model and Session Override Audit

Date: 2026-07-29

## Authority

This audit uses the installed `openclaw@2026.7.1` contract:

- `docs/concepts/models.md`
- `docs/gateway/config-agents.md`
- `dist/schema-BuOFpc7K.js` (`SessionsPatchParamsSchema`)

The configured primary model is `agents.defaults.model.primary`. OpenClaw says
changing it does not rewrite existing session pins. A user session selection is
an exact, strict override, while `sessions.patch` with `model: null` clears that
override and restores configured default routing.

## Findings

### BUG-DM-01 - Saving a global default pins the active session

`App.tsx` handles `aegis:config-saved` by calling `sessions.patch` with the saved
primary model. This changes two independent domains in one action and prevents
an existing session from retaining its explicit model choice.

### BUG-DM-02 - Catalog loading silently chooses and pins a model

When the visible model catalog loads, JunQi patches the active session to the
first catalog row if no prior model is visible or the current model is absent.
Catalog order is presentation data, not a routing decision. A stale strict pin
must fail visibly until the user changes or clears it; it must not be replaced.

### BUG-DM-03 - Session override cannot be cleared

The installed Gateway accepts `sessions.patch { model: null }`, but JunQi's
client type accepts only strings and the composer exposes no restore-default
action. Once pinned, a session therefore cannot return to the configured
fallback chain through the UI.

### BUG-DM-04 - Opening the provider editor mutates default routing

`ProvidersTab` uses an effect to replace an unset or unavailable primary with
the first model in an object. Merely rendering a configuration page must not
create an operator routing decision. Explicit provider/model mutations already
own referential cleanup and routing health already reports invalid references.

### BUG-DM-05 - Renderer storage shadows Gateway model truth

Every effective model returned by `sessions.list` is copied to localStorage and
later used as a fallback. The value does not record whether it was inherited,
user-pinned, or selected by OpenClaw's automatic fallback. It can therefore
survive a changed default and display stale routing after an incomplete read.

### BUG-DM-06 - Session patch response can silently fall back to renderer state

The installed Gateway returns `resolved.modelProvider` and `resolved.model`
after every `sessions.patch`, including a `model: null` reset. JunQi treated
that projection as optional and substituted the submitted model or global
default when it was absent. That hides protocol drift and resolves per-agent
defaults incorrectly. The projection must be validated and remain the only
post-mutation effective-model source.

## Target boundary

- Config save changes configuration only and refreshes the Gateway model view.
- Catalog discovery is read-only and never selects a model.
- Session selection and restore-default are explicit `sessions.patch` actions.
- OpenClaw session/default projections are the only runtime model truth.
- A missing post-patch resolved model is a visible protocol error, never a
  renderer fallback.
- Provider editor rendering does not mutate the draft.

## Implementation

- Removed config-save, catalog-load, and desktop-session creation paths that
  wrote a session model without an explicit user selection.
- Removed the renderer `sessionModelPrefs` persistence layer; `sessions.list`
  and confirmed mutation results now own the displayed runtime model.
- Added an explicit restore action that sends `sessions.patch` with
  `model: null`. The action is available even when no global primary is visible
  because OpenClaw may resolve an agent-level default.
- Kept the last confirmed model catalog mounted while a config-triggered
  Gateway restart is in progress, avoiding a composer control unmount/remount.
- Made `resolved.modelProvider` and `resolved.model` mandatory in the typed
  patch response and reject missing values as protocol drift.

## Validation

- Focused default-model, session-settings, identity, composer, and provider
  routing tests: passed (22 tests before the final response-hardening change;
  13 directly affected tests passed after it).
- `pnpm lint`: passed, including module boundaries and TypeScript.
- `pnpm test`: passed for the complete frontend and script suites.
- `pnpm build`: passed; no circular-chunk or chunk-budget warning was emitted.
- Live provider fallback and agent-specific default routing: not exercised;
  they require real provider credentials and a running authenticated Gateway.

## Unverified boundary

Provider account availability and automatic fallback recovery require live
provider credentials and are not inferred from catalog metadata.
