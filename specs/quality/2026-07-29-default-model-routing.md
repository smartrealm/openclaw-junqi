# Default Model Routing Spec

Date: 2026-07-29

## Acceptance

- [x] Saving `agents.defaults.model.primary` does not patch any session.
- [x] Loading or refreshing the model catalog never patches a session.
- [x] The session runtime control can explicitly clear its model override.
- [x] Clearing uses the installed `sessions.patch { model: null }` contract.
- [x] The post-patch effective model comes from the required Gateway `resolved`
      projection, including per-agent defaults.
- [x] Provider editor rendering does not select the first model implicitly.
- [x] No renderer-persisted model shadow remains in the runtime read path.
- [x] Existing selected rows are marked and cannot be selected again.
- [x] Provider/model labels come from Gateway/catalog data and locale keys, not
      model-specific conditional branches.
- [x] Focused behavior tests, full TypeScript/Rust tests, lint, and build pass.
- [x] Adding a provider preserves current text and image defaults unless the
      operator explicitly selects replacements.
- [x] A primary model is removed from its fallback chain from every settings
      entry point.
- [x] Shared model display contains no model-id-specific label branches.
- [x] Gateway-returned and model-catalog provider ids are not unconditionally
      rewritten by renderer compatibility aliases.
- [x] Selecting `Not set` removes the corresponding default instead of choosing
      a model from catalog order.
- [x] Adding or fetching a model preserves an intentionally unset primary.
- [x] Removing the active primary promotes only the first available configured
      fallback; without one, the primary remains unset.
- [x] The final setup action revalidates selected-runtime structure and the live
      default model before persisting setup completion.
- [x] Rescue labels never derive a default from catalog order, and the provider
      editor does not write the pinned Runtime's unsupported `modelPolicy` key.
