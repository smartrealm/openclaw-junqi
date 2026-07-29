# Default Model Installed-Contract Spec

Date: 2026-07-29

## Acceptance

- [x] JunQi does not write `agents.defaults.modelPolicy` while
      `openclaw@2026.7.1` rejects that field.
- [x] Connected model choices continue to come from
      `models.list { view: "configured" }`.
- [x] Config/file fallback choices follow the pinned Runtime's
      `agents.defaults.models` exact and provider-wildcard visibility rules.
- [x] An explicit primary outside the local metadata map remains visible and is
      preserved by unrelated provider/model edits.
- [x] Explicit clear remains the only generic editor action that removes an
      existing primary.
- [x] Default, per-agent, and per-session model layers remain separate.
- [x] Focused behavior tests and the full validation suite pass.
