# Install Layout Hardening Plan

## Execution order

| Phase | Finding | Work |
| --- | --- | --- |
| A | BUG-IL01 | Add explicit terminal integration for state/config and OpenClaw launcher resolution. |
| A | BUG-IL02 | Resolve automatic npm prefix from the login-shell npm and reject managed-prefix masquerading. |
| B | BUG-IL03 | Extend the persisted layout with runtime and npm cache directories. |
| B | BUG-IL04 | Add a workspace picker and write the selected workspace into OpenClaw configuration. |
| C | BUG-IL05 | Report terminal availability from verified backend status. |
| D | all | Add migration, path validation, UI, and cross-platform regression coverage. |
