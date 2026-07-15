# Gateway Setup and AI Rescue Flow Audit

Date: 2026-07-15

## Critical findings

### BUG-GR-01 - Rescue invents an unconfigured provider model

When a configured provider has no explicit model, `fallbackModelRef` fabricates
`provider/gpt-4o-mini`. For vLLM this produces `vllm/gpt-4o-mini` even when the
server exposes a different model. The UI then presents the fabricated value as
a configured diagnostic target.

### BUG-GR-02 - Authentication failure opens unrelated manual settings

Any direct-model error, including HTTP 401, automatically expands temporary
model configuration. The original target remains selected, while the new form
implies that temporary configuration is already active. The error does not name
the provider or tell the user which credential needs attention.

## Medium findings

### BUG-GR-03 - Gateway setup step can remain below the fixed viewport

The native setup chain contains six steps and Gateway is last. The 342px step
viewport never scrolls to the running step, so Gateway preparation can execute
while the visible list ends at an earlier item.

### BUG-GR-04 - Model selection has weak affordance and incomplete candidates

The native select has no explicit chevron styling and the resolver only lists
agent model references plus one invented provider fallback. Explicit models in
`models.providers.*.models` are not offered.

### BUG-GR-05 - AI mode keeps the full recovery dashboard expanded

Opening AI diagnosis leaves status, recommendation, recovery actions, guidance,
and a second nested header on screen. The chat receives too little vertical
space in popovers and setup recovery surfaces.

### BUG-GR-06 - Gateway preparation failure is displayed as success

The native flow catches a recoverable `prepare_gateway` failure, but then
overwrites the step detail with “configuration is ready.” This hides useful
diagnostic context before the explicit start/retry action.

## Resolution design

- Build rescue targets only from explicit agent references and provider model
  entries. Never invent a model identifier.
- Keep temporary configuration closed after request errors and render a
  provider-aware authentication message for HTTP 401/403.
- Give model selection an explicit dropdown affordance and stable target key.
- Collapse the standard recovery dashboard while AI mode is active.
- Scroll the installation timeline to its active/error/pending step.
- Preserve recoverable preparation failures as warnings and retry on start.
