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

### BUG-DM-07 - Adding a provider silently replaces global defaults

`ConfigureStep` derives both text and image defaults from the first selected
model even when the operator never selected either default. The derived values
are then passed to `applyProviderAddition`, so adding a provider also rewrites
`agents.defaults.model.primary` and `agents.defaults.imageModel`. Provider
registration and global routing are separate decisions; catalog order is not a
default-model choice.

### BUG-DM-08 - The two default-model editors enforce different fallback rules

The provider editor removes a newly selected primary from the fallback chain,
while the Agent defaults editor calls `setModelPrimary` directly and can retain
the same ref in both positions. `setModelFallbacks` also accepts the active
primary. The invariant belongs in the shared model-reference domain, not in one
of its callers.

### BUG-DM-09 - Shared model presentation contains model-specific branches

`ModelDropdown.formatModelName` recognizes a fixed list of Claude, Gemini, GPT,
and o-series ids. This becomes stale as the installed catalog changes and
contradicts the runtime-owned display contract. Gateway/catalog `alias` and
`label` fields are authoritative; the full model ref is the lossless fallback.

### BUG-DM-10 - Session/catalog alias rewriting can steal explicit identities

The session/catalog identity helper unconditionally rewrites provider ids such
as `modelstudio` to another provider. OpenClaw 2026.7.1 explicitly says an exact
custom `models.providers.modelstudio` entry owns its own refs instead of the
Qwen compatibility alias. Session results and model-catalog provider keys must
therefore be preserved; compatibility resolution belongs to OpenClaw's
contextual plugin catalog, not a renderer-wide lookup table.

### BUG-DM-11 - "Not set" is replaced by catalog order

The provider settings UI exposes an explicit `Not set` option for text and
image defaults. `buildDefaultsWithResolvedModels`, however, cannot distinguish
an explicit clear from an omitted override and replaces the empty primary with
the first key in `agents.defaults.models`. The image route similarly chooses
the first locally image-capable entry. The rendered selection therefore lies
about the persisted routing decision and object insertion order becomes model
policy.

### BUG-DM-12 - Model removal ignores the configured fallback order

When the active primary is removed, the same helper promotes the first catalog
key even when `agents.defaults.model.fallbacks` contains an explicit ordered
recovery route. Adding or fetching a model while no primary is configured also
selects the first model implicitly. Catalog reconciliation must preserve an
unset primary, and a removed primary may only promote the first still-available
configured fallback.

### BUG-DM-13 - Setup completion persists before revalidating the default route

The final setup action probes the selected Gateway process and immediately
writes the setup-complete marker. A configuration or credential change made
after the earlier Ready transition can therefore persist an installation whose
default model is structurally incomplete or no longer live. The completion
action must re-read the selected-runtime config and repeat the official live
model probe in the same transaction as the marker write.

### BUG-DM-14 - Secondary controls still treat catalog order as a default

Two read-side controls retained the same implicit-order assumption after the
primary route was cleared. Gateway rescue labeled the first enabled model as
the default, while the provider editor also exposed a session-model restriction
control. Rescue may enumerate configured candidates, but only
`agents.defaults.model.primary` may receive the Default label.

The later installed-contract audit supersedes the restriction half of this
finding: pinned `openclaw@2026.7.1` rejects `agents.defaults.modelPolicy`, so the
control and write path were removed instead of being initialized from a model.

## Target boundary

- Config save changes configuration only and refreshes the Gateway model view.
- Catalog discovery is read-only and never selects a model.
- Session selection and restore-default are explicit `sessions.patch` actions.
- OpenClaw session/default projections are the only runtime model truth.
- A missing post-patch resolved model is a visible protocol error, never a
  renderer fallback.
- Provider editor rendering does not mutate the draft.
- Adding a provider preserves global text/image defaults unless the operator
  explicitly selects replacements.
- Primary/fallback disjointness is enforced by the shared model-reference
  functions used by every editor.
- Model labels and session/catalog provider identities come from runtime/config
  data without model-specific display branches or unconditional compatibility
  rewrites.
- Explicitly clearing a default remains clear; catalog discovery and model
  addition never fill it from object order.
- Removing the active primary promotes the first available configured fallback,
  or leaves the primary unset when no configured fallback remains.
- Setup completion persists only after the selected Gateway, selected-runtime
  configuration, and live default model all pass the final completion gate.
- The pinned Runtime's configured-model visibility is mirrored only for the
  disconnected config fallback; connected choices remain Gateway-owned.
- Diagnostic and session-access controls never promote catalog order to a
  default or policy rule.

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
- Provider addition now preserves current text and image defaults unless the
  operator explicitly chooses a replacement in the provider wizard.
- Moved primary/fallback disjointness into the shared model-reference helpers,
  so every settings entry point enforces the same invariant.
- Replaced model-id-specific display branches with catalog `alias`/`label`
  metadata and a generic short label while retaining the full model ref as
  row detail.
- Removed renderer-wide provider alias rewriting from the Gateway session and
  model-catalog identity layer. Legacy provider-template migrations remain
  isolated in Config Manager and are not treated as runtime model identity.
- Distinguished omitted default overrides from explicit clears. Adding or
  fetching models now preserves an unset route; removing a primary promotes
  only its first remaining configured fallback.
- Gateway rescue and session-access restriction seeding now recognize only the
  explicit primary instead of treating object insertion order as policy.
- Added the final Gateway/config/live-model completion gate before the durable
  setup marker is written.

## Validation

- Focused default-model, policy, provider mutation, and rescue routing tests:
  passed (45 tests).
- `pnpm lint`: passed, including module boundaries and TypeScript.
- `pnpm test`: passed for the complete frontend and script suites; the frontend
  phase reported 1863/1863 and the script phase 223/223 passing tests.
- `pnpm test:rust`: passed with 652 tests and 3 environment-dependent tests
  ignored by their existing contracts.
- `cargo fmt -- --check` and `cargo check --lib`: passed.
- `pnpm verify:openclaw-docs`: passed for 55 official links and anchors.
- `pnpm build`: passed; no circular-chunk or chunk-budget warning was emitted.
- Live provider fallback and agent-specific default routing: not exercised;
  they require real provider credentials and a running authenticated Gateway.

## Unverified boundary

Provider account availability and automatic fallback recovery require live
provider credentials and are not inferred from catalog metadata.

Config Manager still contains explicit legacy provider-template migration
rules. They are versioned compatibility behavior with existing regression
coverage, not a source of session/catalog identity. Removing them requires a
separate migration contract for existing user configurations.
