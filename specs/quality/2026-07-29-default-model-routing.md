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
