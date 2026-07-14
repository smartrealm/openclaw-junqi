# Install Layout Audit

## Findings

### BUG-IL01 - Custom OpenClaw storage is process-local

JunQi passes `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` to its own child
processes, but an external terminal still resolves OpenClaw's default state.
This can split configuration, credentials, sessions, and workspaces across two
locations.

### BUG-IL02 - Managed npm can be mislabeled as the user's npm prefix

`npm config get prefix` currently runs through JunQi's managed Node/npm. Without
a user `prefix` setting, npm returns the managed Node root, which is not
necessarily the prefix used by npm in the user's login shell and is usually not
on the terminal `PATH`.

### BUG-IL03 - Managed dependency locations are implicit

Node.js, npm cache, and Windows MinGit are derived from the OpenClaw state root.
The setup UI neither exposes those resolved paths nor lets a user place the
managed runtime on a separate disk.

### BUG-IL04 - Workspace placement is not independently configurable

Fresh setup always derives `<state>/workspace`. Migration preserves an external
workspace, but setup has no explicit workspace picker or summary.

### BUG-IL05 - PATH wording overstates terminal availability

The installer verifies that an npm prefix is writable, not that its executable
directory is on the user's login `PATH`. The UI currently claims terminal
availability without proving it.

## Design Direction

- Persist one normalized install layout with backward-compatible v1 migration.
- Keep managed Node/Git under a selected runtime root and npm cache under an
  independently selected cache directory.
- Treat a custom npm prefix as an explicit user choice; automatic selection
  must inspect the user's login-shell npm rather than managed npm defaults.
- Make terminal integration explicit, idempotent, removable, and verifiable.
- Keep all system configuration changes behind the user's terminal-integration
  choice.
