# Gateway Setup and AI Rescue Flow Bugfix

## BUG-GR-01 - Explicit rescue targets only

**Current**: a provider without models receives a fabricated
`provider/gpt-4o-mini` target.

**Target**: targets come only from agent model references or explicit provider
model entries.

**Acceptance**:
- [x] vLLM without configured models produces no target.
- [x] every configured provider model is selectable.
- [x] primary model remains first and candidates are deduplicated.

## BUG-GR-02 - Actionable request failure

**Current**: every request error expands temporary settings and displays the raw
provider error.

**Target**: temporary settings remain closed; 401/403 identifies the selected
provider and credential action without exposing a secret.

**Acceptance**:
- [x] request failure does not mutate `manualOpen`.
- [x] 401/403 has a provider-aware localized message.
- [x] retrying another configured model remains available.

## BUG-GR-03 - Visible Gateway step

**Current**: the fixed setup timeline does not follow its active step.

**Target**: the active/error/next step scrolls into view without resizing the
aligned log and timeline panels.

**Acceptance**:
- [x] Gateway preparation scrolls the Gateway row into view.
- [x] fixed 390px/342px panel dimensions remain unchanged.

## BUG-GR-04 - Clear model dropdown

**Current**: the native select has weak affordance and incomplete options.

**Target**: a visible chevron and explicit option count make model switching
clear; one-target state is represented honestly.

**Acceptance**:
- [x] multiple targets render a keyboard-accessible select with visible chevron.
- [x] the selected target is identified by a collision-safe key.
- [x] one target does not imply unavailable alternatives.

## BUG-GR-05 - Compact AI mode

**Current**: AI mode is nested under the complete recovery dashboard.

**Target**: opening AI mode collapses status/actions into a compact mode header,
leaving the available height to target selection, messages, and composer.

**Acceptance**:
- [x] standard recovery body is hidden while AI mode is open.
- [x] temporary model configuration is collapsed by default.
- [x] chat and controls do not exceed the parent width on narrow surfaces.

## BUG-GR-06 - Honest Gateway preparation state

**Current**: a recoverable preparation failure is overwritten by a success-like
pending message.

**Target**: preserve the warning in both the step detail and activity log, then
let the explicit Gateway start action retry validation.

**Acceptance**:
- [x] preparation failure remains visible as a warning.
- [x] the UI states that start will retry automatically.
